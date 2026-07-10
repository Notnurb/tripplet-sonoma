package com.tripplet.index.eval;

import com.tripplet.index.core.Bm25;
import com.tripplet.index.core.Tokenizer;
import com.tripplet.index.core.TopK;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Brute-force EXACT BM25 ranker = ground truth for recall@k. Also the shared
 * source of corpus term statistics (df, avgdl, vocabulary) for the query
 * workload. OWNERSHIP: Agent 2 (eval/).
 *
 * Built to be OBVIOUSLY correct, not fast. Every candidate index is diffed
 * against this; if a candidate disagrees with the Oracle, the candidate is wrong.
 */
public final class Oracle {

    private final Bm25 bm25;
    private final List<Map<String, Integer>> docTf = new ArrayList<>(); // docId -> term -> tf
    private final List<Integer> docLen = new ArrayList<>();
    private final Map<String, Integer> df = new HashMap<>();
    private long totalLen = 0;
    private double avgdl = 1.0;
    private int n = 0;

    public Oracle(Bm25 bm25) { this.bm25 = bm25; }

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

    public void build() {
        avgdl = n == 0 ? 1.0 : (double) totalLen / n;
    }

    public int n() { return n; }
    public double avgdl() { return avgdl; }
    public int df(String term) { return df.getOrDefault(term, 0); }
    public Set<String> vocabulary() { return df.keySet(); }

    /** Exact BM25 score of a raw query string against one doc. Each query term counted once. */
    public double scoreOf(int docId, String query) {
        if (docId < 0 || docId >= docTf.size()) return 0.0;
        Map<String, Integer> tf = docTf.get(docId);
        if (tf == null) return 0.0;
        int dl = docLen.get(docId);
        double s = 0.0;
        Set<String> seen = new HashSet<>();
        for (String qt : Tokenizer.tokenize(query)) {
            if (!seen.add(qt)) continue;
            Integer f = tf.get(qt);
            if (f == null) continue;
            double idf = Bm25.idf(n, df.getOrDefault(qt, 0));
            s += bm25.impact(idf, f, dl, avgdl);
        }
        return s;
    }

    /** Exact top-k: score desc, tie-break docId asc. THE ground truth. */
    public int[] topK(String query, int k) {
        double[] scores = new double[docTf.size()];
        for (int d = 0; d < docTf.size(); d++) {
            if (docTf.get(d) != null) scores[d] = scoreOf(d, query);
        }
        return TopK.select(scores, k);
    }
}
