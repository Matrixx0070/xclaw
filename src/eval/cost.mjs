/**
 * Rough USD estimates for eval reports (list prices; update as needed).
 * Not billing-accurate — for trend comparison only.
 */
const RATES = {
  // approx $ per 1M tokens
  "grok-4.3": { in: 3.0, out: 15.0 },
  "grok-3": { in: 3.0, out: 15.0 },
  "grok-2": { in: 2.0, out: 10.0 },
  "gpt-4o": { in: 2.5, out: 10.0 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  default: { in: 3.0, out: 15.0 },
};

export function rateForModel(model) {
  const m = String(model || "");
  // Prefer longer keys first so gpt-4o-mini wins over gpt-4o
  const keys = Object.keys(RATES)
    .filter((k) => k !== "default")
    .sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (m.includes(k)) return RATES[k];
  }
  return RATES.default;
}

/**
 * @param {{ prompt?: number, completion?: number }} tokens
 * @param {string} [model]
 */
export function estimateUsd(tokens, model) {
  const r = rateForModel(model);
  const pin = (tokens?.prompt || 0) / 1e6;
  const pout = (tokens?.completion || 0) / 1e6;
  const usd = pin * r.in + pout * r.out;
  return {
    usd: Math.round(usd * 1e6) / 1e6,
    rates: r,
    model: model || null,
    note: "estimate only",
  };
}
