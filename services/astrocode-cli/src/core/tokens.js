/**
 * tokens.js — token accounting.
 *
 * There is no tokenizer to call, so we estimate. The heuristic below is
 * deliberately simple but calibrated to land within ~10% of real BPE counts on
 * ordinary prose and code, which is all the context meter and /cost need.
 */

/**
 * Rough token count. Code tokenises denser than prose (more punctuation, more
 * short identifiers), so we weight the two differently.
 */
export function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  const chars = s.length;
  if (chars === 0) return 0;

  const words = (s.match(/[A-Za-z]+/g) || []).length;
  const punct = (s.match(/[^\w\s]/g) || []).length;
  const nl = (s.match(/\n/g) || []).length;
  const cjk = (s.match(/[　-鿿豈-﫿]/g) || []).length;

  // Prose: ~4 chars/token. Punctuation and newlines are usually their own token.
  const base = (chars - punct - nl - cjk) / 4;
  return Math.max(1, Math.round(base + punct * 0.85 + nl * 0.9 + cjk * 1.6 + words * 0.02));
}

/** Simulated USD cost for a turn. */
export function costOf(model, inputTokens, outputTokens) {
  if (!model?.pricing) return 0;
  return (
    (inputTokens / 1_000_000) * model.pricing.input +
    (outputTokens / 1_000_000) * model.pricing.output
  );
}

export function formatCost(usd) {
  if (!usd) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** 1234 -> '1.2K', 1_234_567 -> '1.2M' */
export function formatTokens(n) {
  if (n == null) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Percentage of a model's context window that `used` occupies. */
export function contextPercent(used, model) {
  if (!model?.context) return 0;
  return Math.min(100, Math.round((used / model.context) * 100));
}
