// Prompt-injection defense-in-depth for EXTERNAL content (web search results,
// fetched pages, memory rows) before it is placed into model context.
//
// This is the second layer: the first is the system prompt declaring such
// content untrusted. Both chat (memory/search injection) and the Sonoma tool
// loop (web_search / fetch_url results) run everything through here.

export function sanitizeExternalContent(raw: string): string {
    // -- Structural normalization (run BEFORE keyword matching) --------------
    // Keyword/regex filtering alone is bypassable by splitting words with
    // invisible characters (a zero-width space inside "ignore") or reordering
    // with bidi controls. These characters have no legitimate place in plain
    // external text, so we drop them first -- this collapses the obfuscated
    // variants back onto the patterns below instead of trying to enumerate
    // every encoding trick.
    let safe = raw
        // Zero-width space/non-joiner/joiner (U+200B-200D), word-joiner
        // (U+2060), BOM/zero-width no-break space (U+FEFF).
        .replace(/[​-‍⁠﻿]/g, '')
        // Bidirectional embeddings/overrides (U+202A-202E) and directional
        // isolates (U+2066-2069) used for RLO/LRO smuggling.
        .replace(/[‪-‮⁦-⁩]/g, '')
        // C0/C1 control chars except tab (U+0009), newline (U+000A), CR (U+000D).
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

    // HTML/markdown comments can hide directives from a human reviewer while
    // the model still reads them -- neutralize the whole comment.
    safe = safe.replace(/<!--[\s\S]*?-->/g, '[filtered]');

    // Prevent tag-escape: strip wrapper tag names so content cannot close the
    // envelopes the routes place around it.
    safe = safe
        .replace(/<\/?memory_context[^>]*>/gi, '')
        .replace(/<\/?web_search_results[^>]*>/gi, '')
        .replace(/<\/?internal_reasoning[^>]*>/gi, '');

    // Strip prompt-injection directives. Allow chains of qualifier words so we
    // catch "ignore all previous instructions" as well as "ignore instructions"
    // and "disregard prior rules".
    const injectionPatterns: RegExp[] = [
        /\b(ignore|disregard|forget|override)\s+(?:(?:all|every|any|previous|above|prior|earlier|last|the|your)\s+)*(?:instructions?|prompts?|rules?|guidelines?|constraints?|messages?|system\s+prompt)\b/gi,
        /\bnew\s+instructions?:/gi,
        // Role-reassignment framings ("you are now ...", "act as ...").
        /\b(?:you\s+are\s+now|from\s+now\s+on(?:\s+you\s+are)?|act\s+as|pretend\s+(?:to\s+be|you\s+are)|roleplay\s+as)\b/gi,
        // Injected chat-role prefixes at the start of a line ("system:", etc.).
        /(^|\n)[ \t]*(system|assistant|developer)[ \t]*:/gi,
        /<\/?(system|instructions?|sys|admin)\b[^>]*>/gi,
    ];
    for (const re of injectionPatterns) {
        safe = safe.replace(re, (m) => (m.startsWith('\n') ? '\n[filtered]' : '[filtered]'));
    }

    return safe;
}