package com.tripplet.index.core;

import java.util.ArrayList;
import java.util.List;

/**
 * Shared top-k selection so every component produces the IDENTICAL total order:
 * score DESC, tie-break docId ASC. OWNERSHIP: Agent 2 (core/).
 *
 * Two entry points:
 *  - select(double[], k):            full-sort, used by the Oracle (correctness > speed).
 *  - selectFrom(int[], int[], n, k): bounded min-heap over a candidate subset,
 *                                    used by SAAT so query latency isn't dominated
 *                                    by an O(N) scan of untouched docs.
 */
public final class TopK {

    private TopK() {}

    /** Oracle path: dense double scores, positive-only, full sort. */
    public static int[] select(double[] scores, int k) {
        if (k <= 0) return new int[0];
        List<Integer> cand = new ArrayList<>();
        for (int d = 0; d < scores.length; d++) if (scores[d] > 0) cand.add(d);
        cand.sort((a, b) -> {
            int c = Double.compare(scores[b], scores[a]);
            return c != 0 ? c : Integer.compare(a, b);
        });
        int size = Math.min(k, cand.size());
        int[] out = new int[size];
        for (int j = 0; j < size; j++) out[j] = cand.get(j);
        return out;
    }

    /**
     * SAAT path: integer accumulators, but we only look at the `candCount`
     * docIds in `cand` (the ones actually touched during accumulation).
     * Uses a size-k min-heap whose ROOT is the worst kept entry.
     */
    public static int[] selectFrom(int[] scores, int[] cand, int candCount, int k) {
        if (k <= 0 || candCount == 0) return new int[0];
        int cap = Math.min(k, candCount);
        int[] hDoc = new int[cap];
        int[] hSc = new int[cap];
        int hs = 0;
        for (int i = 0; i < candCount; i++) {
            int d = cand[i];
            int sc = scores[d];
            if (sc <= 0) continue;
            if (hs < cap) {
                hDoc[hs] = d; hSc[hs] = sc; hs++;
                siftUp(hSc, hDoc, hs - 1);
            } else if (better(sc, d, hSc[0], hDoc[0])) {
                hSc[0] = sc; hDoc[0] = d;
                siftDown(hSc, hDoc, 0, hs);
            }
        }
        // Sort the ≤k survivors into final order: score desc, docId asc.
        Integer[] ord = new Integer[hs];
        for (int j = 0; j < hs; j++) ord[j] = j;
        final int[] fSc = hSc, fDoc = hDoc;
        java.util.Arrays.sort(ord, (a, b) -> {
            int c = Integer.compare(fSc[b], fSc[a]);
            return c != 0 ? c : Integer.compare(fDoc[a], fDoc[b]);
        });
        int[] out = new int[hs];
        for (int j = 0; j < hs; j++) out[j] = fDoc[ord[j]];
        return out;
    }

    /** candidate (sc1,d1) is strictly better than (sc2,d2): higher score, or equal score & lower docId. */
    private static boolean better(int sc1, int d1, int sc2, int d2) {
        if (sc1 != sc2) return sc1 > sc2;
        return d1 < d2;
    }

    /** (a) is worse than (b): lower score, or equal score & higher docId. Root of the heap = global worst. */
    private static boolean worse(int scA, int dA, int scB, int dB) {
        if (scA != scB) return scA < scB;
        return dA > dB;
    }

    private static void siftUp(int[] sc, int[] doc, int i) {
        while (i > 0) {
            int p = (i - 1) >> 1;
            if (worse(sc[i], doc[i], sc[p], doc[p])) { swap(sc, doc, i, p); i = p; }
            else break;
        }
    }

    private static void siftDown(int[] sc, int[] doc, int i, int size) {
        while (true) {
            int l = 2 * i + 1, r = 2 * i + 2, s = i;
            if (l < size && worse(sc[l], doc[l], sc[s], doc[s])) s = l;
            if (r < size && worse(sc[r], doc[r], sc[s], doc[s])) s = r;
            if (s != i) { swap(sc, doc, i, s); i = s; } else break;
        }
    }

    private static void swap(int[] a, int[] b, int i, int j) {
        int t = a[i]; a[i] = a[j]; a[j] = t;
        t = b[i]; b[i] = b[j]; b[j] = t;
    }
}
