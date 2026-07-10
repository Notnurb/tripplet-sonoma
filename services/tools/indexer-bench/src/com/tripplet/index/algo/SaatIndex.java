package com.tripplet.index.algo;

import com.tripplet.index.core.Bm25;
import com.tripplet.index.core.SearchIndex;
import com.tripplet.index.core.Tokenizer;
import com.tripplet.index.core.TopK;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;
import java.util.Set;

/**
 * SAAT — Quantized-Impact, Score-At-A-Time index with anytime early termination.
 * OWNERSHIP: Agent 2 (algo/). Competing entry vs Agent 1's DAAT block-max WAND.
 *
 * WHY THIS IS THE ANSWER TO "great on low-end == great on high-end":
 *   Each (term,doc) BM25 contribution is query-independent, so we precompute it
 *   as an "impact", quantize it to 8 bits, and store each term's postings sorted
 *   by DESCENDING impact. At query time we merge the query terms' postings in
 *   globally-descending impact order into integer accumulators, and stop after a
 *   work budget of `rho` postings. rho is the single anytime knob:
 *
 *     low-end box  -> small rho  -> few postings touched -> low latency; because
 *                     postings are impact-ordered, the highest-scoring docs are
 *                     seen FIRST, so recall degrades gracefully, not randomly.
 *     high-end box -> rho = full -> exact-under-quantization top-k.
 *
 *   ONE algorithm, tuned by ONE integer. All query-time math is integer adds —
 *   no floating point, no divides — which is exactly what a weak CPU wants.
 *
 * HONEST TRADE-OFF (for the benchmark to price out): impact-ordering destroys
 * docId monotonicity, so these postings do NOT delta+varint compress the way
 * Agent 1's docId-sorted lists do. We pay in index bytes to buy anytime latency.
 */
public final class SaatIndex implements SearchIndex {

    private final Bm25 bm25;
    private final int rho;       // work budget in postings; < 0 means full/exact
    private final String label;

    // ---- build-time scratch (freed after build) ----
    private List<Map<String, Integer>> docTf = new ArrayList<>();
    private List<Integer> docLen = new ArrayList<>();
    private final Map<String, Integer> df = new HashMap<>();
    private long totalLen = 0;
    private int n = 0;

    // ---- finalized postings: term -> impact-desc parallel arrays ----
    private final Map<String, int[]> postDocs = new HashMap<>();
    private final Map<String, byte[]> postImp = new HashMap<>(); // quantized 1..255, read as &0xFF
    private long sizeBytes = 0;

    public SaatIndex(Bm25 bm25, int rho, String label) {
        this.bm25 = bm25;
        this.rho = rho;
        this.label = label;
    }

    @Override
    public void add(int docId, String text) {
        List<String> toks = Tokenizer.tokenize(text);
        Map<String, Integer> tf = new HashMap<>();
        for (String t : toks) tf.merge(t, 1, Integer::sum);
        while (docTf.size() <= docId) { docTf.add(null); docLen.add(0); }
        docTf.set(docId, tf);
        docLen.set(docId, toks.size());
        totalLen += toks.size();
        for (String t : tf.keySet()) df.merge(t, 1, Integer::sum);
        n++;
    }

    @Override
    public void build() {
        double avgdl = n == 0 ? 1.0 : (double) totalLen / n;

        // Pass 1: raw float impacts per term + global max (for the quantizer scale).
        Map<String, List<int[]>> tmpDocs = new HashMap<>();     // term -> list of {docId}
        Map<String, List<Double>> tmpImp = new HashMap<>();     // term -> list of impact
        double maxImpact = 0.0;
        for (int d = 0; d < docTf.size(); d++) {
            Map<String, Integer> tf = docTf.get(d);
            if (tf == null) continue;
            int dl = docLen.get(d);
            for (Map.Entry<String, Integer> e : tf.entrySet()) {
                String term = e.getKey();
                double idf = Bm25.idf(n, df.getOrDefault(term, 0));
                double imp = bm25.impact(idf, e.getValue(), dl, avgdl);
                if (imp <= 0) continue;
                tmpDocs.computeIfAbsent(term, x -> new ArrayList<>()).add(new int[]{d});
                tmpImp.computeIfAbsent(term, x -> new ArrayList<>()).add(imp);
                if (imp > maxImpact) maxImpact = imp;
            }
        }
        if (maxImpact <= 0) maxImpact = 1.0;

        // Pass 2: linear-quantize to [1,255] and sort each term's postings by impact desc.
        long bytes = 0;
        for (Map.Entry<String, List<Double>> en : tmpImp.entrySet()) {
            String term = en.getKey();
            List<Double> is = en.getValue();
            List<int[]> ds = tmpDocs.get(term);
            int m = is.size();

            Integer[] order = new Integer[m];
            for (int j = 0; j < m; j++) order[j] = j;
            order = sortByImpactDesc(order, is);

            int[] docs = new int[m];
            byte[] imp = new byte[m];
            for (int j = 0; j < m; j++) {
                int src = order[j];
                docs[j] = ds.get(src)[0];
                int q = (int) Math.round(255.0 * is.get(src) / maxImpact);
                if (q < 1) q = 1; else if (q > 255) q = 255;
                imp[j] = (byte) q;
            }
            postDocs.put(term, docs);
            postImp.put(term, imp);
            bytes += (long) m * (4 + 1) + term.length() * 2L + 32; // postings + rough dict entry
        }
        this.sizeBytes = bytes;

        // free scratch
        docTf = null;
        docLen = null;
    }

    private static Integer[] sortByImpactDesc(Integer[] order, List<Double> imp) {
        java.util.Arrays.sort(order, (a, b) -> Double.compare(imp.get(b), imp.get(a)));
        return order;
    }

    @Override
    public int[] topK(String query, int k) {
        if (k <= 0) return new int[0];

        // Distinct query terms that actually exist in the index.
        List<String> terms = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String qt : Tokenizer.tokenize(query)) {
            if (seen.add(qt) && postDocs.containsKey(qt)) terms.add(qt);
        }
        if (terms.isEmpty()) return new int[0];

        int T = terms.size();
        int[][] docsArr = new int[T][];
        byte[][] impArr = new byte[T][];
        int totalPostings = 0;
        for (int t = 0; t < T; t++) {
            docsArr[t] = postDocs.get(terms.get(t));
            impArr[t] = postImp.get(terms.get(t));
            totalPostings += docsArr[t].length;
        }

        int[] acc = new int[n];
        int[] touched = new int[Math.min(totalPostings, n)];
        int touchedCount = 0;

        // Max-heap of cursors by current (quantized) impact. cursor = {termIdx, pos}.
        final byte[][] fImp = impArr;
        PriorityQueue<int[]> pq = new PriorityQueue<>(
            (a, b) -> Integer.compare(fImp[b[0]][b[1]] & 0xFF, fImp[a[0]][a[1]] & 0xFF));
        for (int t = 0; t < T; t++) {
            if (docsArr[t].length > 0) pq.add(new int[]{t, 0});
        }

        long budget = rho < 0 ? Long.MAX_VALUE : rho;
        long processed = 0;
        while (!pq.isEmpty() && processed < budget) {
            int[] cur = pq.poll();
            int t = cur[0], pos = cur[1];
            int doc = docsArr[t][pos];
            if (acc[doc] == 0) touched[touchedCount++] = doc;
            acc[doc] += (impArr[t][pos] & 0xFF);
            processed++;
            int np = pos + 1;
            if (np < docsArr[t].length) { cur[1] = np; pq.add(cur); }
        }

        return TopK.selectFrom(acc, touched, touchedCount, k);
    }

    @Override
    public long indexSizeBytes() { return sizeBytes; }

    @Override
    public String name() {
        return label != null ? label : ("SAAT(rho=" + (rho < 0 ? "full" : rho) + ")");
    }
}
