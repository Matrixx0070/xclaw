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

import { runAgentLoop } from "./loop.mjs";

/** @typedef {"cli"|"telegram"|"webchat"|"discord"|"slack"|"email"|"tui"|"api"|"automation"|"unknown"} AgentChannel */

/**
 * @typedef {object} AgentRequest
 * @property {string} [goal]           Primary user goal / message
 * @property {string} [message]        Alias of goal
 * @property {string} [userMessage]    Alias of goal
 * @property {object} [cfg]
 * @property {string} [workingDir]
 * @property {AbortSignal} [signal]
 * @property {(e: object) => void} [onEvent]
 * @property {boolean} [stream]
 * @property {string} [userId]
 * @property {AgentChannel|string} [channel]  Metadata only
 * @property {string} [chatId]
 * @property {string} [chatSessionId]
 * @property {string} [sessionId]             Alias → chatSessionId
 * @property {string} [conversationId]        Alias → chatSessionId
 * @property {Array<{role:string,content:string}>} [history]
 * @property {string|null} [rescuePrompt]
 * @property {string} [profile]               Optional profile name (cfg still authoritative)
 */

/**
 * @typedef {object} AgentResponse
 * @property {boolean} ok
 * @property {string} text
 * @property {string|null} [error]
 * @property {number} [turns]
 * @property {string} [model]
 * @property {object[]} [toolTrace]
 * @property {object[]} [suggestions]
 * @property {object|null} [turnState]
 * @property {string|null} [stopReason]
 * @property {object} [raw]
 * @property {AgentChannel|string} [channel]
 * @property {string} [sessionId]
 */

/**
 * Normalize any surface payload into the single loop options object.
 * Channel does not change tools, model selection, or autonomy policy.
 *
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
    // reserved for A1+ — not forked by channel
    profile: req.profile || null,
  };
}

/**
 * Single entry for all channels. Same goal → same loop contract.
 *
 * @param {AgentRequest} req
 * @returns {Promise<AgentResponse>}
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
      cfg: opts.cfg,
      workingDir: opts.workingDir,
      signal: opts.signal,
      onEvent: opts.onEvent,
      stream: opts.stream,
      userId: opts.userId,
      channel: opts.channel,
      chatId: opts.chatId,
      chatSessionId: opts.chatSessionId,
      ...(opts.history !== undefined ? { history: opts.history } : {}),
      ...(opts.rescuePrompt ? { rescuePrompt: opts.rescuePrompt } : {}),
    });

    const text =
      raw?.finalText ||
      raw?.text ||
      raw?.reply ||
      (typeof raw === "string" ? raw : "") ||
      "(no response)";

    return {
      ok: true,
      text,
      turns: raw?.turns,
      model: raw?.model,
      toolTrace: raw?.toolTrace,
      suggestions: raw?.suggestions || [],
      turnState: raw?.turnState || null,
      stopReason: raw?.stopReason || null,
      usage: raw?.usage,
      raw,
      channel: opts.channel,
      sessionId: opts.chatSessionId,
    };
  } catch (e) {
    return {
      ok: false,
      text: "",
      error: e?.message || String(e),
      channel: opts.channel,
      sessionId: opts.chatSessionId,
    };
  }
}

export default runAgent;
