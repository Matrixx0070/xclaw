/**
 * Post-turn follow-up chips — schema-native (toolTrace status/outcome/artifacts)
 * + turn closure detection + durable feedback bias.
 */

import {
  applySuggestionBias,
} from "./suggestion-feedback.mjs";
import {
  inspectGitWorktree,
  buildCommitChipPrompt,
} from "./git-status.mjs";

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   prompt: string,
 *   kind?: string,
 *   source?: string,
 *   score?: number,
 *   grounded?: boolean,
 * }} Suggestion
 */

const MAX_LABEL = 72;
const MAX_PROMPT = 240;

/** @param {string} s @param {number} n */
function clip(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, Math.max(0, n - 1)).trimEnd() + "…";
}

/** @param {string} s */
function shortPath(s) {
  const t = String(s || "");
  const parts = t.split(/[/\\]/);
  if (parts.length <= 2) return clip(t, 48);
  return clip(parts.slice(-2).join("/"), 48);
}

function entryResultText(t) {
  if (typeof t?.result === "string") return t.result;
  if (t?.resultView?.text) return t.resultView.text;
  if (t?.result?.text) return t.result.text;
  return String(t?.output || t?.content || "");
}

/**
 * Schema-first summary of a toolTrace array.
 * @param {object[]} toolTrace
 */
export function summarizeToolTrace(toolTrace = []) {
  const entries = Array.isArray(toolTrace) ? toolTrace : [];
  const byStatus = {
    ok: 0,
    fail: 0,
    error: 0,
    timeout: 0,
    blocked: 0,
    denied: 0,
    cancelled: 0,
    other: 0,
  };
  const outcomes = [];
  const artifacts = [];
  const failed = [];
  const blocked = [];
  const okWrites = [];
  const okCommands = [];

  for (const e of entries) {
    const st = String(e.status || (e.blocked ? "blocked" : "") || "other");
    if (byStatus[st] != null) byStatus[st] += 1;
    else byStatus.other += 1;

    if (e.outcome?.kind) outcomes.push(e.outcome.kind);

    for (const a of e.artifacts || []) {
      if (a?.ref) artifacts.push(a);
    }

    if (st === "fail" || st === "error" || st === "timeout") {
      failed.push(e);
    }
    if (st === "blocked" || st === "denied" || e.blocked) {
      blocked.push(e);
    }
    if (st === "ok") {
      for (const a of e.artifacts || []) {
        if (a.type === "file" && (a.role === "output" || /write|edit/i.test(e.name || ""))) {
          okWrites.push(a.ref);
        }
        if (a.type === "command") okCommands.push(a.ref);
      }
      // legacy path from args
      const path = e.args?.path || e.args?.file_path;
      if (path && /write|edit/i.test(e.name || "")) okWrites.push(String(path));
    }
  }

  return {
    count: entries.length,
    byStatus,
    outcomes,
    artifacts,
    failed,
    blocked,
    okWrites: [...new Set(okWrites)].slice(0, 6),
    okCommands: [...new Set(okCommands)].slice(0, 4),
    allOk:
      entries.length > 0 &&
      failed.length === 0 &&
      blocked.length === 0 &&
      entries.every((e) => e.status === "ok" || (!e.status && !e.blocked)),
    hasTools: entries.length > 0,
  };
}

/** @deprecated use summarizeToolTrace; kept for tests */
export function extractGrounding(toolTrace = []) {
  const s = summarizeToolTrace(toolTrace);
  return {
    tools: [
      ...new Set(
        (toolTrace || []).map((t) => String(t.name || t.tool || "").toLowerCase()).filter(Boolean)
      ),
    ],
    paths: [
      ...new Set([
        ...s.okWrites,
        ...s.artifacts.filter((a) => a.type === "file").map((a) => a.ref),
      ]),
    ].slice(0, 6),
    commands: [
      ...new Set([
        ...s.okCommands,
        ...s.artifacts.filter((a) => a.type === "command").map((a) => String(a.ref).slice(0, 120)),
      ]),
    ].slice(0, 4),
    errors: s.failed.map((e) => e.name || "tool"),
    blocked: s.blocked.map((e) => e.name || "tool"),
  };
}

/**
 * Heuristic: did this turn complete the user's ask?
 * SCAFFOLD: prose-signal closure detection — a capable model can report closure
 * as structured turn metadata; retire this when the loop asks for it directly.
 * @returns {{ closed: boolean, confidence: number, reason: string }}
 */
export function detectTurnClosure(ctx = {}) {
  const userMessage = String(ctx.userMessage || "").trim();
  const reply = String(ctx.replyText || "").trim();
  const summary = summarizeToolTrace(ctx.toolTrace || []);

  if (!reply || reply === "(no response)") {
    return { closed: false, confidence: 0, reason: "empty" };
  }

  // Open: failures or blocks
  if (summary.failed.length || summary.blocked.length) {
    return {
      closed: false,
      confidence: 0.9,
      reason: summary.blocked.length ? "blocked" : "failed",
    };
  }

  // Open: reply signals continuation
  if (
    /\b(next I(?:'|’)ll|I will next|still need to|TODO|not yet|partially|in progress|let me know if)\b/i.test(
      reply
    )
  ) {
    return { closed: false, confidence: 0.75, reason: "continuation_language" };
  }

  // Open: user asked a pure question and we only explained (no tools) — not "done implementing"
  const userIsQuestion =
    /\?$/.test(userMessage) ||
    /^(what|why|how|when|where|who|explain|describe)\b/i.test(userMessage);
  if (userIsQuestion && !summary.hasTools) {
    // informational Q&A — treat as closed for chip purposes (avoid "go deeper" spam)
    return { closed: true, confidence: 0.55, reason: "answered_question" };
  }

  // Closed: tools all ok and user ask was imperative action
  const userIsAction =
    /^(add|implement|fix|write|create|update|refactor|ship|run|test|wire|build|deploy)\b/i.test(
      userMessage
    ) ||
    /\b(implement|add|fix|wire)\b/i.test(userMessage);

  if (summary.hasTools && summary.allOk && userIsAction) {
    // Extra: reply claims done
    const claimsDone =
      /\b(done|implemented|fixed|added|shipped|complete|all tests pass|passing)\b/i.test(
        reply
      );
    return {
      closed: true,
      confidence: claimsDone ? 0.85 : 0.65,
      reason: claimsDone ? "action_done" : "tools_ok_action",
    };
  }

  // Closed: short confirmatory reply after successful tools
  if (summary.hasTools && summary.allOk && reply.length < 280) {
    if (/\b(done|fixed|complete|ready|all set)\b/i.test(reply)) {
      return { closed: true, confidence: 0.7, reason: "short_done" };
    }
  }

  return { closed: false, confidence: 0.4, reason: "open" };
}

/**
 * @returns {{ suppress: boolean, reason?: string, closure?: object }}
 */
export function shouldSuppressSuggestions(ctx = {}) {
  const conf = ctx.cfg?.suggestions || ctx.cfg?.agent?.suggestions || {};
  if (conf.enabled === false) return { suppress: true, reason: "disabled" };

  const reply = String(ctx.replyText || "").trim();
  const userMessage = String(ctx.userMessage || "").trim();

  if (!reply || reply === "(no response)") {
    return { suppress: true, reason: "empty_reply" };
  }
  // Pure ack only: short and almost nothing else
  if (
    reply.length <= 24 &&
    /^(ok|done|sure|yes|no|thanks|thx|got it)[.!]?$/i.test(reply)
  ) {
    return { suppress: true, reason: "ack" };
  }
  // Greetings — no "implementation steps" chips
  if (
    /^(hi|hello|hey|yo|sup|good (morning|afternoon|evening))\b/i.test(userMessage) &&
    userMessage.length < 40
  ) {
    return { suppress: true, reason: "greeting" };
  }
  if (
    ctx.pendingApproval ||
    /approval required|waiting for approval/i.test(reply)
  ) {
    return { suppress: true, reason: "approval" };
  }
  if (/\b(no suggestions|\/quiet)\b/i.test(userMessage)) {
    return { suppress: true, reason: "user_quiet" };
  }

  // Closure gate (1+2)
  const closure = detectTurnClosure(ctx);
  const minConf =
    Number(conf.closureMinConfidence) >= 0
      ? Number(conf.closureMinConfidence)
      : 0.6;
  if (conf.suppressOnClose !== false && closure.closed && closure.confidence >= minConf) {
    // Commit chip when closed + dirty worktree (or explicit config)
    const commitMode = conf.closedAllowCommitChip; // true | false | "auto"
    let allowCommit = commitMode === true;
    if (commitMode === "auto" || commitMode == null || commitMode === "dirty") {
      // default auto: only if git dirty (checked in buildTurnSuggestions via ctx.git)
      allowCommit = true; // candidate — buildTurnSuggestions filters on dirty
    }
    if (allowCommit) {
      return { suppress: false, reason: "closed_allow_commit", closure };
    }
    return { suppress: true, reason: "closed", closure };
  }

  return { suppress: false, closure };
}

/**
 * Build ranked chips from normalized toolTrace only (+ light domain if open).
 */
export function buildTurnSuggestions(ctx = {}) {
  const conf = ctx.cfg?.suggestions || ctx.cfg?.agent?.suggestions || {};
  const gate = shouldSuppressSuggestions(ctx);

  // Resolve git dirty (optional, fast, best-effort)
  let git = ctx.git || null;
  if (!git && ctx.workingDir && conf.skipGitInspect !== true) {
    try {
      git = inspectGitWorktree(ctx.workingDir, {
        timeoutMs: conf.gitTimeoutMs || 2500,
      });
    } catch {
      git = null;
    }
  }

  if (gate.suppress) {
    return [];
  }

  // Closed + commit path: at most one commit chip when dirty (or force)
  if (gate.reason === "closed_allow_commit" || gate.closure?.closed) {
    const mode = conf.closedAllowCommitChip; // true | false | "auto"
    const force = mode === true;
    const auto = mode === "auto" || mode === "dirty" || mode == null;
    const dirty = Boolean(git?.isRepo && git?.dirty);
    if (force || (auto && dirty)) {
      const prompt = buildCommitChipPrompt(git, ctx.toolTrace || []);
      const n = git?.fileCount || 0;
      const label =
        n > 0
          ? `Commit ${n} change${n === 1 ? "" : "s"}`
          : "Commit these changes";
      return [
        {
          id: `sug_commit_${Math.random().toString(36).slice(2, 7)}`,
          label,
          prompt,
          kind: "commit",
          source: "closure",
          score: 0.9,
          grounded: true,
          meta: {
            branch: git?.branch || null,
            fileCount: n,
            samplePaths: git?.samplePaths || [],
          },
        },
      ];
    }
    // closed and clean (or commit disabled) → no chips
    if (gate.closure?.closed && conf.suppressOnClose !== false) {
      return [];
    }
  }

  const max = Math.min(6, Math.max(1, Number(conf.max) || 3));
  const minScore = Number(conf.minScore) >= 0 ? Number(conf.minScore) : 0.35;
  const preferMax = gate.closure?.closed ? 1 : max;

  const summary = summarizeToolTrace(ctx.toolTrace || []);
  const recent = new Set(
    (ctx.recentPrompts || []).map((p) => String(p).toLowerCase().slice(0, 80))
  );

  /** @type {Suggestion[]} */
  const candidates = [];
  const add = (item, score, source) => {
    if (!item?.label || !item?.prompt) return;
    const prompt = clip(item.prompt, MAX_PROMPT);
    const key = prompt.toLowerCase().slice(0, 80);
    if (recent.has(key)) return;
    candidates.push({
      id: `sug_${candidates.length}_${Math.random().toString(36).slice(2, 7)}`,
      label: clip(item.label, MAX_LABEL),
      prompt,
      kind: item.kind || "followup",
      source,
      score,
      grounded: Boolean(item.grounded),
    });
  };

  // --- Schema-native: failures ---
  for (const e of summary.failed.slice(0, 2)) {
    const kind = e.outcome?.kind || "unknown";
    const sum = e.outcome?.summary || e.name || "tool";
    add(
      {
        label:
          kind === "test_fail"
            ? "Fix the failing tests"
            : `Diagnose ${clip(e.name || "failure", 40)}`,
        prompt:
          kind === "test_fail"
            ? `Fix the failing tests (${sum}). Re-run until green.`
            : `Diagnose why ${e.name || "the tool"} failed (${sum}) and propose a concrete fix`,
        kind: "diagnose",
        grounded: true,
      },
      0.95,
      "trace_fail"
    );
  }

  // --- Schema-native: blocked ---
  for (const e of summary.blocked.slice(0, 1)) {
    add(
      {
        label: "Safer alternative to the block",
        prompt: `The tool ${e.name || ""} was blocked (${e.policy?.reason || e.outcome?.summary || "policy"}). Propose the safest alternative approach`,
        kind: "security",
        grounded: true,
      },
      0.9,
      "trace_blocked"
    );
  }

  // --- Schema-native: successful file artifacts ---
  if (!summary.failed.length) {
    for (const ref of summary.okWrites.slice(0, 2)) {
      const sp = shortPath(ref);
      add(
        {
          label: `Review ${sp}`,
          prompt: `Review ${ref} and list risks or missing tests`,
          kind: "review",
          grounded: true,
        },
        0.8,
        "trace_artifact"
      );
      add(
        {
          label: `Tests for ${sp}`,
          prompt: `Add or outline focused tests for ${ref}`,
          kind: "test",
          grounded: true,
        },
        0.76,
        "trace_artifact"
      );
    }
  }

  // --- Schema-native: successful commands ---
  if (!summary.failed.length) {
    for (const cmd of summary.okCommands.slice(0, 1)) {
      add(
        {
          label: "Explain that command",
          prompt: `Explain this command and result briefly: ${clip(cmd, 100)}`,
          kind: "explain",
          grounded: true,
        },
        0.72,
        "trace_command"
      );
    }
  }

  // --- Domain only when turn is open and weak grounding ---
  const groundedCount = candidates.filter((c) => c.score >= 0.75).length;
  const corpus = `${ctx.userMessage || ""}\n${String(ctx.replyText || "").slice(0, 1500)}`;
  if (groundedCount < 2 && !summary.failed.length) {
    if (/\b(oauth|jwt|jwks|pkce)\b/i.test(corpus)) {
      add(
        {
          label: "Harden token refresh errors",
          prompt: "Add robust error handling for token refresh failures",
          kind: "implement",
        },
        0.55,
        "domain"
      );
    }
    if (/\b(telegram|webhook)\b/i.test(corpus)) {
      add(
        {
          label: "Harden Telegram retries",
          prompt: "Harden Telegram API error handling and 429 backoff",
          kind: "implement",
        },
        0.55,
        "domain"
      );
    }
  }

  // Generics only if almost nothing grounded
  if (candidates.filter((c) => (c.score || 0) >= 0.7).length === 0) {
    add(
      {
        label: "Next 3 implementation steps",
        prompt: "Propose the next 3 implementation steps in priority order",
        kind: "plan",
      },
      0.4,
      "generic"
    );
    add(
      {
        label: "List risks and edge cases",
        prompt: "List risks, edge cases, and failure modes for what we just did",
        kind: "risks",
      },
      0.38,
      "generic"
    );
  }

  // Apply durable feedback bias (source|kind CTR)
  const biasMap = ctx.biasMap || null;
  for (const c of candidates) {
    const base = c.score || 0;
    c.scoreRaw = base;
    c.score = applySuggestionBias(base, c.source, c.kind, biasMap);
  }

  candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const k = c.prompt.toLowerCase().slice(0, 80);
    if (seen.has(k)) continue;
    if ((c.score || 0) < minScore) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= preferMax) break;
  }
  return out;
}

const feedbackLog = [];
const FEEDBACK_MAX = 200;

export function recordSuggestionFeedback({
  suggestionId,
  prompt,
  event,
  chatId,
}) {
  feedbackLog.push({
    suggestionId,
    prompt: String(prompt || "").slice(0, 120),
    event,
    chatId: chatId != null ? String(chatId) : null,
    at: Date.now(),
  });
  while (feedbackLog.length > FEEDBACK_MAX) feedbackLog.shift();
}

export function getSuggestionFeedbackStats() {
  const tapped = feedbackLog.filter((f) => f.event === "tapped").length;
  const shown = feedbackLog.filter((f) => f.event === "shown").length;
  return {
    entries: feedbackLog.length,
    shown,
    tapped,
    tapRate: shown ? tapped / shown : 0,
  };
}

export function recentTappedPrompts(limit = 20) {
  return feedbackLog
    .filter((f) => f.event === "tapped" || f.event === "shown")
    .slice(-limit)
    .map((f) => f.prompt);
}

export function formatSuggestionsPlain(suggestions) {
  if (!suggestions?.length) return "";
  const lines = ["", "—", "Next:"];
  suggestions.forEach((s, i) => lines.push(`${i + 1}. ${s.label}`));
  return lines.join("\n");
}

export function suggestionsInlineKeyboard(suggestions) {
  if (!suggestions?.length) return null;
  const rows = suggestions.slice(0, 4).map((s) => [
    {
      text: `↳ ${clip(s.label, 60)}`,
      callback_data: `xclaw:sug:${String(s.id).slice(0, 48)}`.slice(0, 64),
    },
  ]);
  return { inline_keyboard: rows };
}

export default {
  summarizeToolTrace,
  extractGrounding,
  detectTurnClosure,
  shouldSuppressSuggestions,
  buildTurnSuggestions,
  recordSuggestionFeedback,
  getSuggestionFeedbackStats,
  recentTappedPrompts,
  formatSuggestionsPlain,
  suggestionsInlineKeyboard,
};
