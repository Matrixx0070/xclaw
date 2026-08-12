/**
 * Parity gap #2 — Deep tool-loop detection (OpenClaw-inspired).
 * Detects: exact repeat, argument churn, no-progress, threshold exceed.
 */
import { createHash } from "node:crypto";

function stableHash(obj) {
  const s = typeof obj === "string" ? obj : JSON.stringify(obj ?? {});
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

export function createToolLoopDetector(opts = {}) {
  const maxExact = opts.maxExactRepeats ?? 3;
  const maxChurn = opts.maxArgumentChurn ?? 6;
  const maxNoProgress = opts.maxNoProgress ?? 5;
  const maxSameTool = opts.maxSameTool ?? 12;

  const history = []; // { name, argsHash, args, resultHash, ts }
  let lastProgressHash = null;
  let noProgressStreak = 0;
  let sameToolStreak = { name: null, n: 0 };

  function detect(name, args, resultText) {
    const argsHash = stableHash(args);
    const resultHash = stableHash(String(resultText || "").slice(0, 2000));
    const entry = { name, argsHash, args, resultHash, ts: Date.now() };
    history.push(entry);
    if (history.length > 50) history.shift();

    // same tool streak
    if (sameToolStreak.name === name) sameToolStreak.n += 1;
    else sameToolStreak = { name, n: 1 };

    // exact repeats: same name+args
    const exact = history.filter((h) => h.name === name && h.argsHash === argsHash);
    if (exact.length >= maxExact) {
      return {
        stuck: true,
        level: "critical",
        kind: "exact_repeat",
        message: `Tool loop: ${name} repeated with identical arguments ${exact.length} times. Stop and change approach.`,
      };
    }

    // argument churn: same tool, many different args, similar short results
    const sameName = history.filter((h) => h.name === name);
    const uniqueArgs = new Set(sameName.map((h) => h.argsHash));
    if (sameName.length >= maxChurn && uniqueArgs.size >= maxChurn - 1) {
      const shortResults = sameName.filter((h) => h.resultHash).length;
      if (shortResults >= maxChurn - 1) {
        return {
          stuck: true,
          level: "warning",
          kind: "argument_churn",
          message: `Tool loop: ${name} called ${sameName.length} times with changing args but little variety in outcomes.`,
        };
      }
    }

    // no progress: result hash unchanged across tools
    if (lastProgressHash && resultHash === lastProgressHash) {
      noProgressStreak += 1;
    } else {
      noProgressStreak = 0;
      lastProgressHash = resultHash;
    }
    if (noProgressStreak >= maxNoProgress) {
      return {
        stuck: true,
        level: "warning",
        kind: "no_progress",
        message: `No progress: tool results look identical for ${noProgressStreak} steps.`,
      };
    }

    if (sameToolStreak.n >= maxSameTool) {
      return {
        stuck: true,
        level: "critical",
        kind: "same_tool_cap",
        message: `Tool ${name} used ${sameToolStreak.n} times in a row. Cap exceeded.`,
      };
    }

    return { stuck: false, level: "ok", kind: null, message: null };
  }

  function snapshot() {
    return {
      historyLen: history.length,
      noProgressStreak,
      sameToolStreak: { ...sameToolStreak },
    };
  }

  function reset() {
    history.length = 0;
    lastProgressHash = null;
    noProgressStreak = 0;
    sameToolStreak = { name: null, n: 0 };
  }

  return { detect, snapshot, reset };
}
