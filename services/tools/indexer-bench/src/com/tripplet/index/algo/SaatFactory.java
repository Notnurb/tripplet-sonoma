package com.tripplet.index.algo;

import com.tripplet.index.core.Bm25;
import com.tripplet.index.core.SearchIndex;

import java.util.ArrayList;
import java.util.List;

/**
 * Produces the SAAT anytime sweep: several work-budget (ρ) settings as separate
 * SearchIndex rows so Agent 1's Benchmark can plot SAAT's recall-vs-latency
 * curve without any interface change — each ρ is just another SearchIndex.
 * OWNERSHIP: Agent 2 (algo/).
 *
 * Usage in the harness:
 *   for (SearchIndex idx : SaatFactory.sweep(Bm25.defaults())) { feed corpus; build; time; }
 *
 * ρ = -1 means "full/exact" (process every posting). The finite budgets model
 * progressively weaker hardware / tighter latency SLAs on the SAME index design.
 */
public final class SaatFactory {

    private SaatFactory() {}

    /** Low-end → high-end sweep. Tune in the harness if the corpus is much bigger. */
    public static final int[] DEFAULT_RHO = {64, 256, 1024, 4096, -1};

    public static List<SearchIndex> sweep(Bm25 bm25) {
        return sweep(bm25, DEFAULT_RHO);
    }

    public static List<SearchIndex> sweep(Bm25 bm25, int[] rhos) {
        List<SearchIndex> out = new ArrayList<>(rhos.length);
        for (int r : rhos) {
            out.add(new SaatIndex(bm25, r, r < 0 ? "SAAT(full)" : "SAAT(rho=" + r + ")"));
        }
        return out;
    }
}
