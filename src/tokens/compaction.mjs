/**
 * Context compaction for long-horizon XClaw runs (P0).
 *
 * Layers (applied in order when pressure is high):
 *  1. Tool offload — large tool results → durable files + short handles in transcript
 *  2. Structured extractive summary — fold aged turns into a compact system note
 *  3. (Optional) LLM summary — if opts.summarizeFn provided
 *
 * Protects: leading system message (cache + OAuth attestation), recent turns.
 * Complements eviction.mjs (truncate/drop) with reversible offload + summary.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { messageChars } from "./eviction.mjs";
import { measureContextPressure } from "./pressure.mjs";

export const OAUTH_SAFE_NOTE =
  "Compaction must never strip or rewrite the leading system attestation prefix.";

/**
 * @param {object} [opts]
 * @param {string} [opts.dir] offload directory
 */
export function defaultOffloadDir(opts = {}) {
  return (
    opts.dir ||
    process.env.XCLAW_COMPACT_OFFLOAD_DIR ||
    path.join(os.homedir(), ".xclaw", "compact-offload")
  );
}

/**
 * Offload large tool-role messages to disk; replace content with a handle preview.
 * Reversible: agent can re-read path from the stub.
 *
 * @param {object[]} messages
 * @param {object} [opts]
 * @param {number} [opts.thresholdChars=4000]
 * @param {number} [opts.previewChars=400]
 * @param {string} [opts.dir]
 * @returns {Promise<{ messages: object[], report: object }>}
 */
export async function offloadToolResults(messages, opts = {}) {
  const threshold = opts.thresholdChars ?? 4000;
  const previewChars = opts.previewChars ?? 400;
  const dir = defaultOffloadDir(opts);
  const actions = [];
  if (!Array.isArray(messages)) {
    return { messages: messages || [], report: { actions, offloaded: 0 } };
  }

  await fs.mkdir(dir, { recursive: true });
  const out = [];

  for (const msg of messages) {
    if (msg?.role !== "tool") {
      out.push(msg);
      continue;
    }
    const raw =
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content ?? "");
    if (raw.length < threshold) {
      out.push(msg);
      continue;
    }
    if (String(raw).startsWith("[xclaw-offload]")) {
      out.push(msg);
      continue;
    }

    const id =
      msg.tool_call_id ||
      crypto.randomBytes(8).toString("hex");
    const file = path.join(dir, `${id.replace(/[^\w.-]/g, "_")}.txt`);
    await fs.writeFile(file, raw, "utf8");
    const preview = raw.slice(0, previewChars);
    const stub = [
      "[xclaw-offload]",
      `path: ${file}`,
      `bytes: ${Buffer.byteLength(raw, "utf8")}`,
      `tool_call_id: ${msg.tool_call_id || ""}`,
      "preview:",
      preview,
      raw.length > previewChars ? "\n…[truncated — re-read path to restore]" : "",
    ].join("\n");

    out.push({ ...msg, content: stub, _offloadPath: file });
    actions.push({
      type: "offload",
      tool_call_id: msg.tool_call_id,
      path: file,
      beforeChars: raw.length,
      afterChars: stub.length,
    });
  }

  return {
    messages: out,
    report: {
      actions,
      offloaded: actions.length,
      dir,
    },
  };
}

/**
 * Build a structured extractive summary of aged messages (no LLM required).
 */
export function buildExtractiveSummary(messages, opts = {}) {
  const maxChars = opts.maxChars ?? 3000;
  const lines = [];
  lines.push("## Compacted session state");
  lines.push("");

  const goals = [];
  const files = new Set();
  const tools = [];
  const errors = [];
  const decisions = [];
  // Intel-audit #4: fold-of-folds MUST NOT truncate a prior compaction note to
  // 200 chars. Carry the most recent prior note verbatim so accumulated state
  // survives repeated folds.
  let priorState = null;

  for (const m of messages || []) {
    const text =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((p) => p?.text || "").join("\n")
          : m.tool_calls
            ? JSON.stringify(m.tool_calls)
            : "";

    if (m._compaction || (m.role === "user" && text.startsWith("[xclaw-compaction]"))) {
      priorState = text.replace(/^\[xclaw-compaction\]\s*/, "");
      continue; // don't also treat it as a 200-char "goal"
    }
    if (m.role === "user" && text) {
      const first = text.trim().slice(0, 200);
      if (first) goals.push(first);
    }
    if (m.role === "assistant" && text) {
      const d = text.trim().slice(0, 180);
      if (d) decisions.push(d);
    }
    if (m.role === "assistant" && m.tool_calls) {
      for (const tc of m.tool_calls) {
        tools.push(tc.function?.name || tc.name || "tool");
      }
    }
    if (m.role === "tool") {
      const pathHits = String(text).match(
        /(?:\/[\w./-]+\.\w{1,8}|[A-Za-z]:\\[\w\\./-]+)/g
      );
      if (pathHits) pathHits.slice(0, 5).forEach((p) => files.add(p));
      if (/error|exception|failed|ENOENT|EACCES/i.test(text)) {
        errors.push(String(text).slice(0, 160));
      }
    }
  }

  if (priorState) {
    lines.push("### Carried state (from earlier compaction — authoritative)");
    // keep the bulk of it; only clamp pathologically long prior notes
    lines.push(priorState.length > 2400 ? priorState.slice(0, 2400) + "\n…" : priorState);
    lines.push("");
  }
  if (goals.length) {
    lines.push("### User intent (recent)");
    for (const g of goals.slice(-3)) lines.push(`- ${g}`);
    lines.push("");
  }
  if (tools.length) {
    const counts = {};
    for (const t of tools) counts[t] = (counts[t] || 0) + 1;
    lines.push("### Tools used");
    for (const [n, c] of Object.entries(counts).slice(0, 20)) {
      lines.push(`- ${n} ×${c}`);
    }
    lines.push("");
  }
  if (files.size) {
    lines.push("### Paths touched");
    for (const f of [...files].slice(0, 25)) lines.push(`- ${f}`);
    lines.push("");
  }
  if (errors.length) {
    lines.push("### Errors seen");
    for (const e of errors.slice(-5)) lines.push(`- ${e}`);
    lines.push("");
  }
  if (decisions.length) {
    lines.push("### Assistant notes (tail)");
    for (const d of decisions.slice(-4)) lines.push(`- ${d}`);
    lines.push("");
  }
  lines.push("### Next");
  lines.push("- Continue from protected recent turns below; re-read offload paths if full tool output needed.");

  let body = lines.join("\n");
  if (body.length > maxChars) body = body.slice(0, maxChars) + "\n…";
  return body;
}

/**
 * Fold older turns into one user-visible summary message; keep system + recent.
 *
 * @param {object[]} messages
 * @param {object} [opts]
 * @param {number} [opts.keepRecent=8]
 * @param {number} [opts.minAgeToFold=6]
 * @param {(msgs:object[])=>Promise<string>} [opts.summarizeFn] optional LLM summarizer
 */
export async function foldAgedTurns(messages, opts = {}) {
  const keepRecent = opts.keepRecent ?? 8;
  const minAge = opts.minAgeToFold ?? 6;
  if (!Array.isArray(messages) || messages.length < minAge + keepRecent) {
    return { messages: messages || [], report: { folded: false, reason: "too_short" } };
  }

  const head = [];
  let rest = [...messages];
  if (rest[0]?.role === "system") {
    head.push(rest[0]);
    rest = rest.slice(1);
  }
  // Preserve OAuth attestation: never modify head[0]

  if (rest.length < minAge + keepRecent) {
    return { messages: messages, report: { folded: false, reason: "rest_too_short" } };
  }

  const aged = rest.slice(0, rest.length - keepRecent);
  let recent = rest.slice(rest.length - keepRecent);
  // B2 fold-of-folds invariant: at most ONE [xclaw-compaction] note survives
  // a fold. A prior summary inside the recent window is promoted into aged
  // (its facts merge into the new note) instead of stacking.
  const priorInRecent = recent.filter((m) => m._compaction);
  if (priorInRecent.length) {
    aged.unshift(...priorInRecent);
    recent = recent.filter((m) => !m._compaction);
  }

  let summaryText;
  let llmUsed = false;
  if (typeof opts.summarizeFn === "function") {
    try {
      summaryText = await opts.summarizeFn(aged);
      llmUsed = Boolean(summaryText);
    } catch {
      summaryText = null;
    }
  }
  if (!summaryText) {
    summaryText = buildExtractiveSummary(aged, { maxChars: opts.summaryMaxChars ?? 3000 });
  }

  const summaryMsg = {
    role: "user",
    content: `[xclaw-compaction]\n${summaryText}`,
    _compaction: true,
  };

  return {
    messages: [...head, summaryMsg, ...recent],
    report: {
      folded: true,
      agedCount: aged.length,
      recentCount: recent.length,
      summaryChars: summaryText.length,
      llm: llmUsed,
    },
  };
}

/**
 * Full compaction pass: pressure → offload → optional fold.
 *
 * @param {object[]} messages
 * @param {object} [opts]
 * @param {object} [opts.pressure] precomputed pressure report
 * @param {number} [opts.triggerPressure=0.7]
 * @param {number} [opts.foldPressure=0.85]
 * @param {boolean} [opts.enabled=true]
 */
export async function compactMessages(messages, opts = {}) {
  if (opts.enabled === false) {
    return { messages, report: { skipped: true, reason: "disabled" } };
  }

  const pressure =
    opts.pressure ||
    measureContextPressure(messages, {
      maxChars: opts.maxChars,
      maxMessages: opts.maxMessages,
    });

  const trigger = opts.triggerPressure ?? 0.7;
  const foldAt = opts.foldPressure ?? 0.85;
  const report = { pressure, phases: [] };

  let current = messages;

  if (pressure.pressure < trigger) {
    return { messages: current, report: { ...report, skipped: true, reason: "below_trigger" } };
  }

  // Phase 1: offload
  const off = await offloadToolResults(current, {
    thresholdChars: opts.offloadThresholdChars ?? 4000,
    previewChars: opts.offloadPreviewChars ?? 400,
    dir: opts.offloadDir,
  });
  current = off.messages;
  report.phases.push({ phase: "offload", ...off.report });

  // Phase 2: fold if still critical
  const pressure2 = measureContextPressure(current, {
    maxChars: opts.maxChars,
    maxMessages: opts.maxMessages,
  });
  report.pressureAfterOffload = pressure2;

  if (pressure2.pressure >= foldAt || opts.forceFold) {
    const folded = await foldAgedTurns(current, {
      keepRecent: opts.keepRecent ?? 8,
      minAgeToFold: opts.minAgeToFold ?? 6,
      summarizeFn: opts.summarizeFn,
      summaryMaxChars: opts.summaryMaxChars,
    });
    current = folded.messages;
    report.phases.push({ phase: "fold", ...folded.report });
  }

  report.pressureFinal = measureContextPressure(current, {
    maxChars: opts.maxChars,
    maxMessages: opts.maxMessages,
  });
  report.skipped = false;
  return { messages: current, report };
}

/**
 * Config from XClaw cfg.tokens.compaction / cfg.compaction
 */
export function compactionOptsFromConfig(cfg = {}) {
  const c = cfg.tokens?.compaction || cfg.compaction || {};
  return {
    enabled: c.enabled !== false,
    triggerPressure: c.triggerPressure ?? 0.7,
    foldPressure: c.foldPressure ?? 0.85,
    offloadThresholdChars: c.offloadThresholdChars ?? 4000,
    keepRecent: c.keepRecent ?? 8,
    maxChars: c.maxChars ?? cfg.tokens?.eviction?.maxChars ?? 120_000,
    maxMessages: c.maxMessages ?? cfg.tokens?.eviction?.maxMessages ?? 40,
    offloadDir: c.offloadDir,
  };
}

export default {
  offloadToolResults,
  buildExtractiveSummary,
  foldAgedTurns,
  compactMessages,
  compactionOptsFromConfig,
  defaultOffloadDir,
};
