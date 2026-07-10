package com.tripplet.index.eval;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * Deterministic Zipfian query workload derived from the LIVE corpus vocabulary
 * (via Oracle df stats), plus edit-distance-1 typo variants and multi-term
 * queries. Seeded RNG => byte-identical workload across runs and across both
 * agents' machines. OWNERSHIP: Agent 2 (eval/).
 *
 * Mix: 50% single-term (Zipf by df, so hot terms dominate like real traffic),
 *      35% two-term, 15% single-term with a typo (stresses the fold/robustness).
 */
public final class QueryWorkload {

    public static final class Query {
        public final String text;
        public final String kind;
        Query(String text, String kind) { this.text = text; this.kind = kind; }
        @Override public String toString() { return kind + ":" + text; }
    }

    private QueryWorkload() {}

    public static List<Query> build(Oracle oracle, int count, long seed) {
        List<String> vocab = new ArrayList<>(oracle.vocabulary());
        // Rank by df desc so rank 1 = most frequent term; Zipf then favours hot terms.
        vocab.sort((a, b) -> Integer.compare(oracle.df(b), oracle.df(a)));
        int V = vocab.size();
        List<Query> out = new ArrayList<>(count);
        if (V == 0) return out;

        Random rnd = new Random(seed);
        // Zipf(s=1) CDF over ranks 1..V.
        final double s = 1.0;
        double H = 0;
        for (int i = 1; i <= V; i++) H += 1.0 / Math.pow(i, s);
        double[] cdf = new double[V];
        double acc = 0;
        for (int i = 0; i < V; i++) { acc += (1.0 / Math.pow(i + 1, s)) / H; cdf[i] = acc; }

        for (int i = 0; i < count; i++) {
            double r = rnd.nextDouble();
            if (r < 0.50) {
                out.add(new Query(sampleZipf(vocab, cdf, rnd), "single"));
            } else if (r < 0.85) {
                String a = sampleZipf(vocab, cdf, rnd);
                String b = sampleZipf(vocab, cdf, rnd);
                out.add(new Query(a + " " + b, "double"));
            } else {
                out.add(new Query(typo(sampleZipf(vocab, cdf, rnd), rnd), "typo"));
            }
        }
        return out;
    }

    private static String sampleZipf(List<String> vocab, double[] cdf, Random rnd) {
        double r = rnd.nextDouble();
        int lo = 0, hi = cdf.length - 1;
        while (lo < hi) {
            int mid = (lo + hi) >>> 1;
            if (cdf[mid] < r) lo = mid + 1; else hi = mid;
        }
        return vocab.get(lo);
    }

    private static String typo(String w, Random rnd) {
        if (w.length() < 3) return w;
        char[] c = w.toCharArray();
        int i = rnd.nextInt(c.length);
        switch (rnd.nextInt(3)) {
            case 0: // transpose adjacent
                if (i < c.length - 1) { char t = c[i]; c[i] = c[i + 1]; c[i + 1] = t; }
                return new String(c);
            case 1: // substitute
                c[i] = (char) ('a' + rnd.nextInt(26));
                return new String(c);
            default: // delete
                StringBuilder sb = new StringBuilder(w);
                sb.deleteCharAt(i);
                return sb.toString();
        }
    }
}
