package com.tripplet.index.core;

/**
 * Frozen v1 contract shared by every candidate index in the head-to-head.
 * OWNERSHIP: Agent 2 (core/). Do NOT fork this file — propose contract changes
 * in communication.md and we re-freeze together.
 *
 * CONTRACT (frozen v1):
 *  - docIds passed to add() are DENSE, 0..N-1, in add() order. Indexes may size
 *    dense arrays on that assumption; the corpus layer must honour it.
 *  - topK() returns up to k docIds ordered by DESCENDING relevance score, ties
 *    broken by ASCENDING docId. This total order must be identical across all
 *    implementations so recall@k against the Oracle is well-defined.
 *  - All implementations tokenize via core.Tokenizer and (if scored) target the
 *    same BM25 params via core.Bm25 — otherwise term stats diverge and the
 *    comparison is meaningless.
 */
public interface SearchIndex {

    /** Feed one document's full text (fields already concatenated by the corpus layer). v1 = single stream. */
    void add(int docId, String text);

    /** Finalize the index after all add() calls. Called once. */
    void build();

    /** Up to k docIds, score desc, tie-break docId asc. Never returns null. */
    int[] topK(String query, int k);

    /** Self-reported serialized footprint in bytes (the memory column of the report). */
    long indexSizeBytes();

    /** Human label for benchmark rows, e.g. "SAAT(rho=256)" or "ABC-WAND". */
    String name();
}
