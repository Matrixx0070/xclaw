/**
 * A0 — Channel-invariant agent entry.
 *
 * Telegram / Web UI / TUI / CLI / automations MUST call `runAgent` (or
 * `replyWithAgent`, which delegates here). Behavior is identical; `channel`
 * is identity + telemetry only — never a fork for tools, model, or autonomy.
 *
 *   import { runAgent } from "../agent/run-agent.mjs";
 *   const out = await runAgent({ goal: "…", channel: "telegram", … });
 */

import { applyClaimsGateToResult } from "./claims-gate.mjs";
import { runAgentLoop, stripClaimsBlock } from "./loop.mjs";

/**
 * The loop returns BOTH finalText (raw, WITH the claims scaffold — what the
 * claims gate must score) and text (stripped presentation). Preferring
 * finalText and passing it straight through as the outward text was the
 * 2026-08-24 regression that leaked ```json {"claims":…}``` blocks into
 * Telegram replies and voice captions: score raw, present stripped.
 */
export function splitScoreAndPresentationText(raw) {
  const text =
    raw?.finalText ||
    raw?.text ||
    raw?.reply ||
    (typeof raw === "string" ? raw : "") ||
    "(no response)";
  const presentationText =
    (raw?.finalText ? raw?.text : null) || stripClaimsBlock(text) || "(no response)";
  return { text, presentationText };
}

/** @typedef {"cli"|"telegram"|"webchat"|"discord"|"slack"|"email"|"tui"|"api"|"automation"|"unknown"} AgentChannel */

/**
 * @typedef {object} AgentRequest
 * @property {string} [goal]
 * @property {string} [message]
 * @property {string} [userMessage]
 * @property {object} [cfg]
 * @property {string} [workingDir]
 * @property {AbortSignal} [signal]
 * @property {(e: object) => void} [onEvent]
 * @property {boolean} [stream]
 * @property {string} [userId]
 * @property {AgentChannel|string} [channel]
 * @property {string} [chatId]
 * @property {string} [chatSessionId]
 * @property {string} [sessionId]
 * @property {string} [conversationId]
 * @property {Array<{role:string,content:string}>} [history]
 * @property {string|null} [rescuePrompt]
 * @property {string} [profile]
 */

/**
 * Normalize any surface payload into the single loop options object.
 * @param {AgentRequest} req
 */
export function normalizeAgentRequest(req = {}) {
  const goal = String(
    req.goal ?? req.message ?? req.userMessage ?? ""
  ).trim();
  const channel = String(req.channel || "unknown").toLowerCase();
  const chatSessionId =
    req.chatSessionId || req.sessionId || req.conversationId || null;

  return {
    userMessage: goal,
    cfg: req.cfg || {},
    workingDir: req.workingDir || process.cwd(),
    signal: req.signal,
    onEvent: typeof req.onEvent === "function" ? req.onEvent : () => {},
    stream: Boolean(req.stream),
    userId: req.userId,
    channel,
    chatId: req.chatId ?? null,
    chatSessionId,
    history: Array.isArray(req.history) ? req.history : undefined,
    rescuePrompt: req.rescuePrompt ?? null,
    profile: req.profile || null,
    // Segmentation contract (S3): undefined = default (auto-continue past
    // the per-segment turn budget); false = single-segment run.
    continuation: req.continuation,
    // Inbound-channel context (spec §16.3): gates the `react` tool.
    channelContext: req.channelContext || null,
    persistRun: req.persistRun,
  };
}

/**
 * Single entry for all channels. Same goal → same loop contract.
 * Applies structured claims gate when cfg/principles require evidence.
 *
 * @param {AgentRequest} req
 * @returns {Promise<object>}
 */
export async function runAgent(req = {}) {
  const opts = normalizeAgentRequest(req);
  if (!opts.userMessage) {
    return {
      ok: false,
      text: "",
      error: "empty_goal",
      channel: opts.channel,
      sessionId: opts.chatSessionId,
    };
  }

  try {
    const raw = await runAgentLoop({
      userMessage: opts.userMessage,
      // Forward the segmentation contract: orchestrators (objective
      // segments) opt out of auto-continuation through this wrapper.
      continuation: opts.continuation,
      cfg: opts.cfg,
      workingDir: opts.workingDir,
      signal: opts.signal,
      onEvent: opts.onEvent,
      stream: opts.stream,
      userId: opts.userId,
      channel: opts.channel,
      chatId: opts.chatId,
      chatSessionId: opts.chatSessionId,
      sessionId: opts.chatSessionId || undefined,
      persistRun: opts.persistRun,
      ...(opts.history !== undefined ? { history: opts.history } : {}),
      ...(opts.rescuePrompt ? { rescuePrompt: opts.rescuePrompt } : {}),
      ...(opts.channelContext ? { channelContext: opts.channelContext } : {}),
    });

    const { text, presentationText } = splitScoreAndPresentationText(raw);

    const evidence = [];
    for (const tr of raw?.toolTrace || []) {
      evidence.push({
        source: "tool",
        id: tr.id || tr.toolCallId || tr.name,
        toolCallId: tr.toolCallId || tr.id,
        summary: `${tr.name || "tool"} → ${tr.status || "ok"}`,
      });
    }
    const gated = applyClaimsGateToResult(
      {
        ok: true,
        text,
        finalText: text,
        presentationText,
        turns: raw?.turns,
        model: raw?.model,
        toolTrace: raw?.toolTrace,
        suggestions: raw?.suggestions || [],
        turnState: raw?.turnState || null,
        stopReason: raw?.stopReason || null,
        usage: raw?.usage,
        goalReceipt: raw?.goalReceipt || null,
        reach: raw?.reach || null,
        raw,
        channel: opts.channel,
        sessionId: opts.chatSessionId,
      },
      { evidence, cfg: opts.cfg, opts: {} }
    );
    // Outward text is what channels render — never the claims scaffold. The
    // gate has already scored the raw text above.
    gated.text = presentationText;
    gated.finalText = presentationText;
    return gated;
  } catch (e) {
    return {
      ok: false,
      text: "",
      finalText: "",
      error: e?.message || String(e),
      channel: opts.channel,
      sessionId: opts.chatSessionId,
    };
  }
}

export default runAgent;
