/**
 * Frozen rank-size caching for tool LRU.
 *
 * Problem: remeasuring message content length every eviction pass injects
 * size noise (truncate/stub/remeasure) that can thrash size-weighted ranks.
 *
 * Solution: stamp each tool message with xclaw_rank_size (and optional
 * xclaw_rank_size_source) when the result is first inserted. Scoring uses
 * that frozen value; budget accounting can still use live content length.
 */

export const RANK_SIZE_KEY = "xclaw_rank_size";
export const RANK_SIZE_SRC_KEY = "xclaw_rank_size_source";

/**
 * Live content character count (not frozen).
 */
export function liveContentChars(msg) {
  if (!msg) return 0;
  if (typeof msg.content === "string") return msg.content.length;
  if (Array.isArray(msg.content)) {
    return msg.content.reduce((n, p) => n + (p?.text?.length || 0), 0);
  }
  return 0;
}

/**
 * Size to use for ranking / scoring.
 * Prefers frozen metadata; falls back to live length.
 */
export function rankSizeOf(msg, opts = {}) {
  if (!msg) return 0;
  const frozen = msg[RANK_SIZE_KEY];
  if (opts.forceLive) return liveContentChars(msg);
  if (typeof frozen === "number" && Number.isFinite(frozen) && frozen >= 0) {
    return frozen;
  }
  // Legacy messages without stamp
  return liveContentChars(msg);
}

/**
 * Stamp (or refresh) frozen rank size on a tool message.
 *
 * @param {object} msg tool message (mutated)
 * @param {object} [opts]
 * @param {number} [opts.size] explicit size; default live content length
 * @param {boolean} [opts.overwrite=false] replace existing freeze
 * @param {string} [opts.source] tag e.g. "insert" | "truncate" | "manual"
 */
export function freezeRankSize(msg, opts = {}) {
  if (!msg || msg.role !== "tool") return msg;
  const has =
    typeof msg[RANK_SIZE_KEY] === "number" && Number.isFinite(msg[RANK_SIZE_KEY]);
  if (has && !opts.overwrite) return msg;

  const size =
    typeof opts.size === "number" && Number.isFinite(opts.size)
      ? Math.max(0, Math.floor(opts.size))
      : liveContentChars(msg);

  msg[RANK_SIZE_KEY] = size;
  msg[RANK_SIZE_SRC_KEY] = opts.source || (has ? "overwrite" : "insert");
  return msg;
}

/**
 * Build a tool message with content + frozen rank size in one step.
 */
export function makeToolMessage({ tool_call_id, content, rankSize, source }) {
  const msg = {
    role: "tool",
    tool_call_id,
    content: content ?? "",
  };
  const size =
    typeof rankSize === "number" ? rankSize : liveContentChars(msg);
  freezeRankSize(msg, { size, overwrite: true, source: source || "insert" });
  return msg;
}

/**
 * Ensure all tool messages in a list have a frozen rank size.
 * Does not overwrite existing freezes unless opts.overwrite.
 */
export function ensureRankSizes(messages, opts = {}) {
  if (!Array.isArray(messages)) return messages;
  for (const m of messages) {
    if (m?.role === "tool") freezeRankSize(m, opts);
  }
  return messages;
}

/**
 * True if message carries a frozen rank size.
 */
export function hasFrozenRankSize(msg) {
  return (
    msg &&
    typeof msg[RANK_SIZE_KEY] === "number" &&
    Number.isFinite(msg[RANK_SIZE_KEY])
  );
}
