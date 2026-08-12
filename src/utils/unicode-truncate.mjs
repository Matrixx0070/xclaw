/**
 * Unicode-safe truncation for messaging limits (Telegram 4096, etc.).
 *
 * Strategies:
 *   - utf16:    UTF-16 code units (Telegram-accurate), cut on code-point boundary
 *   - codepoint: Unicode scalar values
 *   - grapheme: extended grapheme clusters via Intl.Segmenter
 */

/**
 * @returns {boolean}
 */
export function hasGraphemeSegmenter() {
  return typeof Intl !== "undefined" && typeof Intl.Segmenter === "function";
}

/**
 * Cache Segmenter instances by locale key.
 * @type {Map<string, Intl.Segmenter>}
 */
const segmenterCache = new Map();

/**
 * @param {string} [locale]
 * @returns {Intl.Segmenter|null}
 */
export function getGraphemeSegmenter(locale = undefined) {
  if (!hasGraphemeSegmenter()) return null;
  const key = locale == null ? "" : String(locale);
  let seg = segmenterCache.get(key);
  if (!seg) {
    try {
      seg = new Intl.Segmenter(locale || undefined, { granularity: "grapheme" });
      segmenterCache.set(key, seg);
    } catch {
      return null;
    }
  }
  return seg;
}

/**
 * Split string into extended grapheme clusters.
 * Falls back to code points if Segmenter is missing.
 *
 * @param {string} str
 * @param {string} [locale]
 * @returns {string[]}
 */
export function segmentGraphemes(str, locale) {
  const s = String(str ?? "");
  if (!s) return [];
  const seg = getGraphemeSegmenter(locale);
  if (seg) {
    const parts = [];
    for (const { segment } of seg.segment(s)) {
      parts.push(segment);
    }
    return parts;
  }
  return Array.from(s);
}

/**
 * @param {string} str
 * @param {string} [locale]
 * @returns {number}
 */
export function countGraphemes(str, locale) {
  return segmentGraphemes(str, locale).length;
}

/**
 * @param {string} s
 * @returns {boolean}
 */
export function isLoneSurrogate(s) {
  if (!s) return false;
  const c = s.charCodeAt(0);
  if (c >= 0xd800 && c <= 0xdbff) {
    if (s.length < 2) return true;
    const l = s.charCodeAt(1);
    return !(l >= 0xdc00 && l <= 0xdfff);
  }
  if (c >= 0xdc00 && c <= 0xdfff) return true;
  return false;
}

/**
 * Truncate so result.length (UTF-16) ≤ max, never splitting a surrogate pair.
 *
 * @param {string} str
 * @param {number} max
 * @param {string} [ellipsis="…"]
 * @returns {string}
 */
export function truncateUtf16(str, max, ellipsis = "…") {
  const s = String(str ?? "");
  if (!Number.isFinite(max) || max <= 0) return "";
  if (s.length <= max) return s;

  const ell = String(ellipsis ?? "");
  const budget = Math.max(0, max - ell.length);
  if (budget <= 0) return ell.length <= max ? ell.slice(0, max) : "";

  let end = budget;
  const c = s.charCodeAt(end - 1);
  if (end > 0 && c >= 0xdc00 && c <= 0xdfff) {
    end -= 1;
  }
  if (end > 0) {
    const h = s.charCodeAt(end - 1);
    if (h >= 0xd800 && h <= 0xdbff) {
      end -= 1;
    }
  }
  return s.slice(0, Math.max(0, end)) + ell;
}

/**
 * Truncate by Unicode code points.
 *
 * @param {string} str
 * @param {number} maxCodePoints
 * @param {string} [ellipsis="…"]
 */
export function truncateCodePoints(str, maxCodePoints, ellipsis = "…") {
  const s = String(str ?? "");
  if (!Number.isFinite(maxCodePoints) || maxCodePoints <= 0) return "";
  const chars = Array.from(s);
  if (chars.length <= maxCodePoints) return s;
  const ell = String(ellipsis ?? "");
  const ellCp = Array.from(ell);
  const budget = Math.max(0, maxCodePoints - ellCp.length);
  return chars.slice(0, budget).join("") + ell;
}

/**
 * Truncate by extended grapheme clusters (user-perceived characters).
 * Uses Intl.Segmenter when available; falls back to code points.
 *
 * @param {string} str
 * @param {number} maxGraphemes
 * @param {string} [ellipsis="…"]
 * @param {{ locale?: string }} [opts]
 * @returns {string}
 */
export function truncateGraphemes(str, maxGraphemes, ellipsis = "…", opts = {}) {
  const s = String(str ?? "");
  if (!Number.isFinite(maxGraphemes) || maxGraphemes <= 0) return "";

  const parts = segmentGraphemes(s, opts.locale);
  if (parts.length <= maxGraphemes) return s;

  const ell = String(ellipsis ?? "");
  const ellParts = segmentGraphemes(ell, opts.locale);
  const budget = Math.max(0, maxGraphemes - ellParts.length);
  return parts.slice(0, budget).join("") + ell;
}

/**
 * Fit as many whole graphemes as possible under a UTF-16 length budget.
 * Best of both: no split clusters, still under Telegram-style limits.
 *
 * @param {string} str
 * @param {number} maxUtf16
 * @param {string} [ellipsis="…"]
 * @param {{ locale?: string }} [opts]
 * @returns {string}
 */
export function truncateGraphemesToUtf16Budget(
  str,
  maxUtf16,
  ellipsis = "…",
  opts = {}
) {
  const s = String(str ?? "");
  if (!Number.isFinite(maxUtf16) || maxUtf16 <= 0) return "";
  if (s.length <= maxUtf16) return s;

  const ell = String(ellipsis ?? "");
  const budget = Math.max(0, maxUtf16 - ell.length);
  if (budget <= 0) return truncateUtf16(ell, maxUtf16, "");

  const parts = segmentGraphemes(s, opts.locale);
  let out = "";
  for (const g of parts) {
    if (out.length + g.length > budget) break;
    out += g;
  }
  // If nothing fit (first grapheme longer than budget), fall back to utf16 cut
  if (!out && parts[0]) {
    return truncateUtf16(s, maxUtf16, ell);
  }
  return out + ell;
}

/**
 * Head/tail truncate for long tool output, UTF-16 safe.
 *
 * @param {string} str
 * @param {object} [opts]
 */
export function truncateUtf16HeadTail(str, opts = {}) {
  const s = String(str ?? "");
  const max = Math.max(1, Number(opts.max) || 4000);
  if (s.length <= max) return s;
  const marker = opts.marker ?? "\n…(truncated)…\n";
  const inner = Math.max(0, max - marker.length);
  const head = Math.floor(inner * (opts.headRatio ?? 0.7));
  const tail = Math.max(0, inner - head);
  const headPart = truncateUtf16(s, head, "");
  let start = s.length - tail;
  if (start < 0) start = 0;
  if (start < s.length) {
    const c = s.charCodeAt(start);
    if (c >= 0xdc00 && c <= 0xdfff) start += 1;
  }
  const tailPart = s.slice(start);
  return headPart + marker + tailPart;
}

/**
 * Channel-friendly truncate.
 * @param {string} str
 * @param {number} [max=3900]
 * @param {string} [suffix="\n…(truncated)"]
 * @param {{ mode?: "utf16"|"grapheme"|"grapheme-utf16" }} [opts]
 */
export function truncateForChannel(str, max = 3900, suffix = "\n…(truncated)", opts = {}) {
  const s = String(str ?? "");
  if (s.length <= max) return s;
  const mode = opts.mode || "utf16";
  if (mode === "grapheme") {
    // Interpret max as grapheme count
    return truncateGraphemes(s, max, suffix, opts);
  }
  if (mode === "grapheme-utf16") {
    return truncateGraphemesToUtf16Budget(s, max, suffix, opts);
  }
  return truncateUtf16(s, max, suffix);
}

export default {
  hasGraphemeSegmenter,
  getGraphemeSegmenter,
  segmentGraphemes,
  countGraphemes,
  truncateUtf16,
  truncateCodePoints,
  truncateGraphemes,
  truncateGraphemesToUtf16Budget,
  truncateUtf16HeadTail,
  truncateForChannel,
  isLoneSurrogate,
};
