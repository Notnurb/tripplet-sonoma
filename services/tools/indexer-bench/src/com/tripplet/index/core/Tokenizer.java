package com.tripplet.index.core;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Canonical, deterministic tokenizer shared by EVERY index AND the Oracle.
 * OWNERSHIP: Agent 2 (core/).
 *
 * Why frozen & shared: if two indexes tokenize differently their df/tf/avgdl
 * stats diverge, so recall@k vs the Oracle stops meaning anything. There is
 * exactly one tokenizer and everyone calls it.
 *
 * Pipeline: NFKC normalize -> lowercase -> split on non-alphanumeric ->
 * drop stopwords (on the RAW token) -> drop tokens shorter than MIN_LEN ->
 * light deterministic suffix folding. No stemming library on purpose:
 * dependency-free + reproducible on any JDK, which is part of the low-end story.
 */
public final class Tokenizer {

    public static final int MIN_LEN = 2;

    private static final Set<String> STOP = Set.of(
        "the","a","an","and","or","but","of","to","in","on","for","is","are",
        "was","were","be","been","being","it","its","this","that","these","those",
        "as","at","by","with","from","into","than","then","so","such","not","no",
        "he","she","they","we","you","i","his","her","their","our","your","if"
    );

    private Tokenizer() {}

    public static List<String> tokenize(String text) {
        List<String> out = new ArrayList<>();
        if (text == null || text.isEmpty()) return out;
        String norm = Normalizer.normalize(text, Normalizer.Form.NFKC).toLowerCase();
        int n = norm.length();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i <= n; i++) {
            char c = i < n ? norm.charAt(i) : ' ';
            if (Character.isLetterOrDigit(c)) {
                sb.append(c);
            } else if (sb.length() > 0) {
                String raw = sb.toString();
                sb.setLength(0);
                if (raw.length() < MIN_LEN || STOP.contains(raw)) continue;
                String tok = fold(raw);
                if (tok.length() >= MIN_LEN) out.add(tok);
            }
        }
        return out;
    }

    /** Very light, deterministic suffix folding (plurals / common inflections). */
    private static String fold(String t) {
        int L = t.length();
        if (L > 4 && t.endsWith("ies"))  return t.substring(0, L - 3) + "y";   // flies -> fly
        if (L > 4 && t.endsWith("sses")) return t.substring(0, L - 2);         // classes -> class
        if (L > 3 && t.endsWith("es"))   return t.substring(0, L - 2);         // boxes -> box
        if (L > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.substring(0, L - 1); // cats -> cat
        if (L > 5 && t.endsWith("ing"))  return t.substring(0, L - 3);         // running -> runn (ok: shared)
        if (L > 4 && t.endsWith("ed"))   return t.substring(0, L - 2);         // walked -> walk
        return t;
    }
}
