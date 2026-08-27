/**
 * Split long Telegram text under the 4096 limit.
 * Prefers paragraph/newline breaks; never splits UTF-16 surrogate pairs.
 * Telegram counts UTF-16 code units (JS string length).
 */

/** @param {number} c */
export function isHighSurrogate(c) {
  return c >= 0xd800 && c <= 0xdbff;
}

/** @param {number} c */
export function isLowSurrogate(c) {
  return c >= 0xdc00 && c <= 0xdfff;
}

/**
 * UTF-16 code unit length (Telegram's limit basis).
 * @param {string} s
 */
export function utf16Len(s) {
  return String(s || "").length;
}

/**
 * Clamp an index so it does not fall between a surrogate pair.
 * Prefers moving *backward* so the result stays ≤ desired (for chunk ends).
 * @param {string} s
 * @param {number} index  desired end (exclusive) or cut point
 * @param {"end"|"start"} [mode="end"]
 *   end:   result is exclusive end of a slice — never ends after a lone high surrogate
 *   start: result is inclusive start — never starts on a lone low surrogate
 */
export function clampToCodePointBoundary(s, index, mode = "end") {
  const n = s.length;
  if (index <= 0) return 0;
  if (index >= n) return n;

  if (mode === "start") {
    // If index points at low surrogate, back up to the high surrogate
    const c = s.charCodeAt(index);
    if (isLowSurrogate(c) && index > 0 && isHighSurrogate(s.charCodeAt(index - 1))) {
      return index - 1;
    }
    return index;
  }

  // mode === "end": exclusive end index
  // If s[index-1] is high and s[index] is low, we'd be splitting the pair — back up
  const prev = s.charCodeAt(index - 1);
  if (isHighSurrogate(prev) && index < n && isLowSurrogate(s.charCodeAt(index))) {
    return index - 1;
  }
  // If somehow index lands mid-pair from the other side (index on low, prev high already handled)
  return index;
}

/**
 * True if slice s[a:b) would split a surrogate pair at either edge.
 * @param {string} s
 * @param {number} a
 * @param {number} b
 */
export function wouldSplitSurrogate(s, a, b) {
  if (a < 0 || b > s.length || a >= b) return false;
  // start on low surrogate (orphan)
  if (a > 0 && isLowSurrogate(s.charCodeAt(a)) && isHighSurrogate(s.charCodeAt(a - 1))) {
    return true;
  }
  // end after high surrogate only
  if (b < s.length && isHighSurrogate(s.charCodeAt(b - 1)) && isLowSurrogate(s.charCodeAt(b))) {
    return true;
  }
  return false;
}

/**
 * Find a safe split index ≤ start+maxUnits, preferring newlines / spaces.
 * Always returns a code-point-safe exclusive end > start (unless at EOS).
 *
 * @param {string} s
 * @param {number} start  must be code-point aligned
 * @param {number} maxUnits
 */
export function findChunkEnd(s, start, maxUnits) {
  const n = s.length;
  if (start >= n) return n;

  // Ensure start is safe
  start = clampToCodePointBoundary(s, start, "start");

  let hard = Math.min(start + maxUnits, n);
  hard = clampToCodePointBoundary(s, hard, "end");

  // If clamping emptied the window (maxUnits === 1 on a pair), take the full pair
  if (hard <= start) {
    if (start < n && isHighSurrogate(s.charCodeAt(start)) && start + 1 < n) {
      return start + 2;
    }
    return Math.min(start + 1, n);
  }
  if (hard >= n) return n;

  const window = s.slice(start, hard);
  const minKeep = Math.floor(maxUnits * 0.45);

  const tryBreak = (rel) => {
    if (rel < minKeep) return null;
    // exclusive end after the break character
    let end = start + rel + 1;
    end = clampToCodePointBoundary(s, end, "end");
    if (end <= start) return null;
    if (wouldSplitSurrogate(s, start, end)) return null;
    return end;
  };

  let br = window.lastIndexOf("\n");
  let hit = tryBreak(br);
  if (hit != null) return hit;

  br = window.lastIndexOf("\r");
  hit = tryBreak(br);
  if (hit != null) return hit;

  br = window.lastIndexOf(" ");
  hit = tryBreak(br);
  if (hit != null) return hit;

  // Soft hyphen / ideographic space as secondary breaks
  br = window.lastIndexOf("\u3000"); // ideographic space
  hit = tryBreak(br);
  if (hit != null) return hit;

  return hard;
}

/**
 * @param {string} text
 * @param {number} [max=4000] max UTF-16 units per chunk (keep under 4096)
 * @returns {string[]}
 */
export function chunkText(text, max = 4000) {
  const limit = Math.min(4096, Math.max(64, Number(max) || 4000));
  const s = String(text || "");
  if (!s) return [""];
  if (utf16Len(s) <= limit) return [s];

  const parts = [];
  let i = clampToCodePointBoundary(s, 0, "start");
  let guard = 0;
  const maxParts = Math.ceil(s.length / Math.max(1, Math.floor(limit / 4))) + 8;

  while (i < s.length) {
    let end = findChunkEnd(s, i, limit);
    end = clampToCodePointBoundary(s, end, "end");

    if (end <= i) {
      // Force progress by at least one code point
      if (isHighSurrogate(s.charCodeAt(i)) && i + 1 < s.length) {
        end = i + 2;
      } else {
        end = i + 1;
      }
    }

    const piece = s.slice(i, end);
    if (piece) {
      // Final safety: never emit a chunk that ends with lone high surrogate
      if (
        piece.length &&
        isHighSurrogate(piece.charCodeAt(piece.length - 1)) &&
        end < s.length &&
        isLowSurrogate(s.charCodeAt(end))
      ) {
        end -= 1;
        if (end <= i) {
          end = i + 2; // take the full pair
        }
      }
      parts.push(s.slice(i, end));
    }
    i = end;
    guard += 1;
    if (guard > maxParts) {
      if (i < s.length) {
        const rest = s.slice(clampToCodePointBoundary(s, i, "start"));
        if (rest) parts.push(rest);
      }
      break;
    }
  }
  return parts.length ? parts : [s];
}

/**
 * Cap total length then chunk — totalMax cut is surrogate-safe.
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.chunkMax=4000]
 * @param {number} [opts.totalMax=12000]
 * @param {string} [opts.ellipsis]
 */
export function prepareReplyChunks(text, opts = {}) {
  const chunkMax = Math.min(4096, Number(opts.chunkMax) || 4000);
  const totalMax = Math.max(chunkMax, Number(opts.totalMax) || 12_000);
  const ellipsis = opts.ellipsis ?? "\n…(truncated)";
  let s = String(text || "");
  if (utf16Len(s) > totalMax) {
    const budget = Math.max(0, totalMax - ellipsis.length);
    let cut = clampToCodePointBoundary(s, budget, "end");
    // If budget is inside a pair near start, cut may be 0 — still OK
    s = s.slice(0, cut) + ellipsis;
  }
  return chunkText(s, chunkMax);
}

/**
 * Split into head (fits one Telegram message) + overflow chunks.
 */
export function splitHeadAndOverflow(text, maxLen = 4000) {
  const chunks = chunkText(String(text || ""), maxLen);
  if (chunks.length <= 1) {
    return { head: chunks[0] || "", overflow: [] };
  }
  return { head: chunks[0], overflow: chunks.slice(1) };
}


/**
 * Operator chunk limits with the Telegram hard ceiling enforced (sweep
 * #64). Telegram rejects sendMessage text over 4096 UTF-16 units, so a
 * configured chunkMax above it MUST clamp — otherwise every long reply
 * errors live. maxReplyChars never floors below chunkMax (a total cap
 * smaller than one chunk would truncate mid-chunk).
 */
export function resolveChunkLimits(conf = {}) {
  const chunkMax = Math.min(4096, Number(conf.chunkMax || conf.maxChunkChars) || 4000);
  const maxReplyChars = Math.max(chunkMax, Number(conf.maxReplyChars) || 12_000);
  return { chunkMax, maxReplyChars };
}

export default {
  isHighSurrogate,
  isLowSurrogate,
  utf16Len,
  clampToCodePointBoundary,
  wouldSplitSurrogate,
  findChunkEnd,
  chunkText,
  prepareReplyChunks,
  splitHeadAndOverflow,
  resolveChunkLimits,
};
