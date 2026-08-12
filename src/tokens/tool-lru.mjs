/**
 * Tool LRU variants: age-only, size-only, size-weighted (+ dynamic pressure_skew).
 */
import { truncateToolResult } from "../agent/truncate.mjs";
import { resolveLruWeights, createWeightTuner } from "./weight-tune.mjs";
import {
  rankSizeOf,
  freezeRankSize,
  ensureRankSizes,
  liveContentChars,
} from "./rank-size.mjs";

export { createWeightTuner, resolveLruWeights } from "./weight-tune.mjs";
export {
  rankSizeOf,
  freezeRankSize,
  ensureRankSizes,
  liveContentChars,
} from "./rank-size.mjs";
export { makeToolMessage, hasFrozenRankSize, RANK_SIZE_KEY } from "./rank-size.mjs";

export function messageChars(msg) {
  if (!msg) return 0;
  if (typeof msg.content === "string") return msg.content.length;
  if (Array.isArray(msg.content)) {
    return msg.content.reduce((n, p) => n + (p?.text?.length || 0), 0);
  }
  return 0;
}

export function totalChars(messages) {
  return (messages || []).reduce((n, m) => n + messageChars(m), 0);
}

/**
 * Collect tool candidates outside protectRecent tail.
 */
export function collectToolCandidates(messages, protectRecent = 4, opts = {}) {
  // Stamp any legacy tool rows once (does not overwrite existing freezes)
  if (opts.ensureFreeze !== false) ensureRankSizes(messages);

  const n = messages.length;
  const protectFrom = Math.max(0, n - protectRecent);
  const candidates = [];
  for (let i = 0; i < protectFrom; i++) {
    if (messages[i]?.role !== "tool") continue;
    // Ranking size: frozen at insert (immune to later truncate/stub noise)
    const size = rankSizeOf(messages[i], { forceLive: opts.forceLiveSize });
    const live = liveContentChars(messages[i]);
    const age = protectFrom - i; // larger = older
    candidates.push({
      index: i,
      size,
      liveSize: live,
      age,
      msg: messages[i],
      frozen: size !== live || messages[i].xclaw_rank_size != null,
    });
  }
  return candidates;
}

/**
 * Score candidates.
 * mode: "age" | "size" | "size_weighted"
 */
export function scoreCandidates(candidates, opts = {}) {
  const mode = opts.mode || "size_weighted";
  const wAge = opts.wAge ?? 0.35;
  const wSize = opts.wSize ?? 0.65;
  const sizeTransform = opts.sizeTransform || "log"; // log | linear

  if (!candidates.length) return [];

  const maxAge = Math.max(1, ...candidates.map((c) => c.age));
  const maxSize = Math.max(1, ...candidates.map((c) => c.size));

  return candidates.map((c) => {
    const ageN = c.age / maxAge;
    let sizeN;
    if (sizeTransform === "log") {
      sizeN = Math.log(1 + c.size) / Math.log(1 + maxSize);
    } else {
      sizeN = c.size / maxSize;
    }
    let score;
    if (mode === "age") score = ageN;
    else if (mode === "size") score = sizeN;
    else score = wAge * ageN + wSize * sizeN;
    return { ...c, ageN, sizeN, score };
  });
}

/**
 * Apply truncation ladder in score order until under maxChars or exhausted.
 */
export function applyToolLruByScore(messages, opts = {}) {
  const mode = opts.mode || "size_weighted";
  const toolMaxChars = opts.toolMaxChars ?? 2000;
  const maxChars = opts.maxChars ?? 120_000;
  const protectRecent = opts.protectRecent ?? 4;
  const allowSplice = opts.allowSplice !== false;
  const sizeTransform = opts.sizeTransform || "log";

  let msgs = messages.map((m) => ({ ...m }));
  const actions = [];
  const t0 = performance.now();
  const beforeChars = totalChars(msgs);

  // Dynamic / static weights for size_weighted mode
  let weightInfo = {
    wAge: opts.wAge ?? 0.35,
    wSize: opts.wSize ?? 0.65,
    dynamic: false,
  };
  if (mode === "size_weighted") {
    const candidates0 = collectToolCandidates(msgs, protectRecent);
    weightInfo = resolveLruWeights({
      mode,
      wAge: opts.wAge,
      wSize: opts.wSize,
      dynamic: opts.dynamic,
      totalChars: beforeChars,
      maxChars,
      sizes: candidates0.map((c) => c.size),
      lastReport: opts.lastReport,
      prevWeights: opts.prevWeights,
      dualState: opts.dualState,
    });
  }

  const scoreOpts = {
    mode,
    wAge: weightInfo.wAge,
    wSize: weightInfo.wSize,
    sizeTransform,
  };

  const runPass = (phase) => {
    let candidates = collectToolCandidates(msgs, protectRecent);
    if (!candidates.length) return;
    candidates = scoreCandidates(candidates, scoreOpts).sort(
      (a, b) => b.score - a.score
    );

    if (phase === "cap" || phase === "all") {
      for (const c of candidates) {
        const content =
          typeof msgs[c.index]?.content === "string" ? msgs[c.index].content : "";
        if (content.length > toolMaxChars) {
          const trunc = truncateToolResult(content, {
            maxChars: toolMaxChars,
            headChars: Math.floor(toolMaxChars * 0.7),
            tailChars: Math.floor(toolMaxChars * 0.2),
          });
          msgs[c.index] = { ...msgs[c.index], content: trunc.text };
          actions.push({
            type: "truncate",
            phase: "cap",
            index: c.index,
            score: c.score,
            originalChars: trunc.originalChars,
            keptChars: trunc.keptChars,
          });
        }
      }
    }

    if (phase === "budget" || phase === "all") {
      candidates = collectToolCandidates(msgs, protectRecent);
      candidates = scoreCandidates(candidates, scoreOpts).sort(
        (a, b) => b.score - a.score
      );
      for (const c of candidates) {
        if (totalChars(msgs) <= maxChars) break;
        // Re-find index if list shifted — use tool_call_id when possible
        let idx = c.index;
        if (msgs[idx]?.role !== "tool") {
          const id = c.msg?.tool_call_id;
          idx = id
            ? msgs.findIndex((m) => m.role === "tool" && m.tool_call_id === id)
            : -1;
        }
        if (idx < 0 || msgs[idx]?.role !== "tool") continue;

        const content =
          typeof msgs[idx].content === "string" ? msgs[idx].content : "";
        if (content.length <= 32) continue;
        if (content !== "[evicted tool result]") {
          msgs[idx] = {
            ...msgs[idx],
            content: "[evicted tool result]",
          };
          actions.push({
            type: "stub",
            index: idx,
            score: c.score,
            chars: content.length,
          });
        } else if (allowSplice) {
          actions.push({ type: "splice", index: idx, score: c.score });
          msgs.splice(idx, 1);
          return runPass("budget");
        }
      }
    }
  };

  runPass("cap");
  if (totalChars(msgs) > maxChars) runPass("budget");

  const afterChars = totalChars(msgs);
  const ms = performance.now() - t0;
  const freePct =
    beforeChars > 0
      ? Number((((beforeChars - afterChars) / beforeChars) * 100).toFixed(2))
      : 0;

  return {
    messages: msgs,
    actions,
    mode,
    weights: weightInfo,
    dualState: weightInfo.dualState || opts.dualState || null,
    beforeChars,
    afterChars,
    totalChars: afterChars,
    freePct,
    ms,
    truncated: actions.filter((a) => a.type === "truncate").length,
    stubbed: actions.filter((a) => a.type === "stub").length,
    spliced: actions.filter((a) => a.type === "splice").length,
  };
}
