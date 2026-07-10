package com.tripplet.index.core;

/**
 * BM25 scoring math. The frozen params (k1, b) ARE the comparison contract:
 * every scored index and the Oracle must use the same instance/params or the
 * head-to-head is apples-to-oranges. OWNERSHIP: Agent 2 (core/).
 *
 *   score(q,d) = Σ_{t∈q, t∈d}  idf(t) · ( f(t,d)·(k1+1) )
 *                              ------------------------------------
 *                              f(t,d) + k1·( 1 − b + b·|d|/avgdl )
 *
 *   idf(t) = ln( 1 + (N − df(t) + 0.5) / (df(t) + 0.5) )      // BM25+ idf, always ≥ 0
 *
 * Each (term,doc) contribution is query-independent, so it can be precomputed
 * once and stored as an "impact" — that is exactly what the SAAT index exploits.
 */
public final class Bm25 {

    public final double k1;
    public final double b;

    public Bm25(double k1, double b) { this.k1 = k1; this.b = b; }

    /** Canonical Robertson defaults. Proposed frozen values for the head-to-head. */
    public static Bm25 defaults() { return new Bm25(1.2, 0.75); }

    /** Non-negative BM25 idf. N = #docs, df = #docs containing the term. */
    public static double idf(long N, long df) {
        return Math.log(1.0 + (N - df + 0.5) / (df + 0.5));
    }

    /** Per-(term,doc) BM25 contribution given term frequency, doc length, avg doc length. */
    public double impact(double idf, int tf, int docLen, double avgdl) {
        double denom = tf + k1 * (1.0 - b + b * (docLen / avgdl));
        return idf * (tf * (k1 + 1.0)) / denom;
    }
}
