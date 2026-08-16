/**
 * WebChat channel — browser chat UI ↔ agent loop
 */
import { randomUUID } from "node:crypto";
import { runAgent } from "../../agent/run-agent.mjs";
import { runJob } from "../../jobs/job.mjs";
import { handleChannelCommand } from "../commands.mjs";

/** @type {Map<string, { id: string, createdAt: number, messages: Array, workingDir?: string }>} */
const sessions = new Map();

const MAX_SESSIONS = 50;
const MAX_MESSAGES = 200;

function pruneSessions() {
  if (sessions.size <= MAX_SESSIONS) return;
  const sorted = [...sessions.values()].sort((a, b) => a.createdAt - b.createdAt);
  while (sessions.size > MAX_SESSIONS && sorted.length) {
    const old = sorted.shift();
    sessions.delete(old.id);
  }
}

export function createChatSession(opts = {}) {
  pruneSessions();
  const id = randomUUID();
  const session = {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    workingDir: opts.workingDir || process.cwd(),
  };
  sessions.set(id, session);
  return session;
}

export function getChatSession(id) {
  return sessions.get(id) || null;
}

export function listChatSessions() {
  return [...sessions.values()].map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: s.messages.length,
  }));
}

/**
 * Handle an inbound WebChat message: run agent, store history, return reply.
 * @param {{ sessionId?: string, message: string, cfg: object, onEvent?: Function, signal?: AbortSignal }} opts
 */
export async function handleWebChatMessage({ sessionId, message, cfg, onEvent, signal, mode, verify }) {
  if (!message || typeof message !== "string" || !message.trim()) {
    throw new Error("message is required");
  }
  if (signal?.aborted) throw new Error("aborted");

  let session = sessionId ? getChatSession(sessionId) : null;
  if (!session) {
    session = createChatSession({ workingDir: cfg.paths?.workspaces });
  }

  const userMsg = {
    id: randomUUID(),
    role: "user",
    content: message.trim(),
    at: Date.now(),
  };
  session.messages.push(userMsg);

  // Phase P: slash commands parity with Telegram/Discord
  if (message.trim().startsWith("/")) {
    const cmd = await handleChannelCommand({
      text: message.trim(),
      cfg,
      workingDir: session.workingDir,
      channel: "webchat",
      userId: session.userId || session.id || null,
      chatId: session.id || null,
      onEvent,
    });
    if (cmd.handled) {
      const assistantMsg = {
        id: randomUUID(),
        role: "assistant",
        content: cmd.reply || "OK",
        at: Date.now(),
      };
      session.messages.push(assistantMsg);
      return {
        sessionId: session.id,
        reply: assistantMsg,
        text: cmd.reply || "OK",
        command: true,
        messages: session.messages,
      };
    }
  }

  session.updatedAt = Date.now();

  // Long-run objective routing (same router as processInbound channels):
  // /objective commands, escalation answers, in-flight status. Detached
  // mission updates append to the session so history/SSE surfaces them.
  if (cfg.objectives?.enabled !== false) {
    try {
      const { routeObjective } = await import("../runtime.mjs");
      const { replyWithAgent } = await import("../base.mjs");
      const routed = await routeObjective({
        text: message.trim(),
        inbound: {
          channel: "webchat",
          chatId: session.id,
          userId: session.userId || session.id,
          identity: `webchat:${session.id}`,
        },
        cfg,
        workingDir: session.workingDir,
        replyWithAgent,
        onEvent,
        notify: async (t) => {
          session.messages.push({
            id: randomUUID(),
            role: "assistant",
            content: String(t),
            at: Date.now(),
          });
          session.updatedAt = Date.now();
        },
      });
      if (routed) {
        const assistantMsg = {
          id: randomUUID(),
          role: "assistant",
          content: routed.reply || "OK",
          at: Date.now(),
        };
        session.messages.push(assistantMsg);
        return {
          sessionId: session.id,
          reply: assistantMsg,
          text: routed.reply || "OK",
          objective: true,
          messages: session.messages,
        };
      }
    } catch (err) {
      onEvent?.({ type: "objective", phase: "route_error", message: String(err?.message || err) });
    }
  }

  const events = [];
  try {
    let result;
    let jobMeta = null;
    if (mode === "job") {
      const job = await runJob({
        goal: message.trim(),
        cfg,
        workspace: session.workingDir,
        verify: Array.isArray(verify) ? verify : [],
        signal,
        autoApprove: true,
        onEvent: (e) => {
          events.push({ ...e, at: Date.now() });
          onEvent?.(e);
        },
      });
      jobMeta = {
        id: job.id,
        status: job.status,
        pass: job.pass,
        evidence: job.evidence,
        verify: job.verify,
      };
      result = {
        text: job.pass
          ? (job.text || `Job ${job.status}`)
          : `Job ${job.status}${job.error ? ": " + job.error : ""}\n\n${job.text || ""}`,
        turns: job.turns,
        model: job.model,
        toolTrace: job.toolTrace,
        usage: job.usage,
      };
    } else {
      result = await runAgent({
        goal: message.trim(),
        cfg,
        channel: "webchat",
        chatSessionId: session.id,
        workingDir: session.workingDir || process.cwd(),
        signal,
        onEvent: (e) => {
          events.push({ ...e, at: Date.now() });
          onEvent?.(e);
        },
      });
    }

    if (signal?.aborted) throw new Error("aborted");

    const assistantMsg = {
      id: randomUUID(),
      role: "assistant",
      content: result.text,
      turns: result.turns,
      model: result.model,
      toolTrace: result.toolTrace,
      usage: result.usage,
      job: jobMeta,
      suggestions: result.suggestions || [],
      turnState: result.turnState || null,
      at: Date.now(),
    };
    session.messages.push(assistantMsg);
    if (session.messages.length > MAX_MESSAGES) {
      session.messages = session.messages.slice(-MAX_MESSAGES);
    }
    session.updatedAt = Date.now();

    return {
      sessionId: session.id,
      reply: assistantMsg,
      userMessage: userMsg,
      turns: result.turns,
      model: result.model,
      usage: result.usage,
      job: jobMeta,
      suggestions: result.suggestions || [],
      turnState: result.turnState || null,
      events,
    };
  } catch (err) {
    // On abort, keep the user message in history but mark incomplete
    if (err.message === "aborted" || signal?.aborted) {
      session.messages.push({
        id: randomUUID(),
        role: "assistant",
        content: "(cancelled — client disconnected)",
        cancelled: true,
        at: Date.now(),
      });
      session.updatedAt = Date.now();
    }
    throw err;
  }
}

export function getHistory(sessionId) {
  const session = getChatSession(sessionId);
  if (!session) return null;
  return {
    sessionId: session.id,
    messages: session.messages,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}
