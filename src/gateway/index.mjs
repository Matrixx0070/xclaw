/**
 * XClaw Gateway — Phase 3.1
 * Computer + agent API + WebChat + SSE event streaming
 */
import http from "node:http";
import { createHttpServer } from "./tls.mjs";
import { tryHandleSecurityRoute } from "./routes/security.mjs";
import { tryHandleSwarmRoute } from "./routes/swarm.mjs";
import { tryHandleCronRoute } from "./routes/cron.mjs";
import { tryHandleJwksRoute } from "./routes/jwks.mjs";
import { tryHandleAlertsRoute } from "./routes/alerts.mjs";
import { tryHandleOpsRoute } from "./routes/ops.mjs";
import { tryHandleLedgerRoute } from "./routes/ledger.mjs";
import { tryHandleEvalQueueRoute } from "./routes/eval-queue.mjs";
import { tryHandleTokensRoute } from "./routes/tokens.mjs";
import { tryHandleSessionsRoute } from "./routes/sessions.mjs";
import { tryHandleSubagentsRoute } from "./routes/subagents.mjs";
import { tryHandleMcpRoute } from "./routes/mcp.mjs";
import { tryHandleMediaRoute } from "./routes/media.mjs";
import { tryHandleHooksRoute } from "./routes/hooks.mjs";
import { tryHandleMissionsRoute } from "./routes/missions.mjs";
import { tryHandleObjectivesRoute } from "./routes/objectives.mjs";
import { tryHandlePointRoute } from "./routes/point.mjs";
import { tryHandleCompletionRoute } from "./routes/completion.mjs";
import { tryHandleProvidersRoute } from "./routes/providers.mjs";
import { tryHandleChannelsRoute } from "./routes/channels.mjs";
import { applyCors } from "./cors.mjs";
import { attachWebSocketHub, broadcast as wsBroadcast } from "./ws-hub.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { listArtifacts } from "../artifacts/browser.mjs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config/load.mjs";
import {
  startComputer,
  isComputerRunning,
  stopComputer,
} from "../computer/manager.mjs";
import { startComputerWatchdog, stopComputerWatchdog } from "../computer/watchdog.mjs";
import {
  startChannelHealthWatchdog,
  stopChannelHealthWatchdog,
  channelHealthStatus,
} from "../channels/health-watchdog.mjs";
import { runAgentLoop } from "../agent/loop.mjs";
import {
  handleWebChatMessage,
  getHistory,
  listChatSessions,
  createChatSession,
} from "../channels/webchat/index.mjs";
import { initSSE, sendSSE, closeSSE, isSSEOpen, bindSSEAbort, onAbort, createStreamWriter, prefersNdjson } from "./sse.mjs";
import {
  parseLastEventId,
  resolveStreamResume,
  createProducer,
  attachWriterToLog,
  resolveStreamOptsFromConfig,
} from "./stream-resume.mjs";
import { recordStreamError } from "../utils/stream-telemetry.mjs";

function streamOpts(cfg) {
  return resolveStreamOptsFromConfig(cfg || {});
}

function noteStreamNotFound(kind, resume) {
  try {
    recordStreamError({
      kind: kind || "unknown",
      code: "STREAM_NOT_FOUND",
      message: `Unknown streamId: ${resume?.streamId}`,
      streamId: resume?.streamId ?? null,
      lastEventId: resume?.lastEventId ?? null,
      retryable: false,
      phase: "server",
    });
  } catch {
    /* */
  }
}

import {
  pushEvictionEvent,
  subscribeEvictionSSE,
} from "./eviction-events.mjs";
import { createChannelManager } from "../channels/manager.mjs";
import { ensureHeartbeat } from "../cron/heartbeat.mjs";

import { configureSubagentPersistence } from "../agents/spawn.mjs";
import { createChannelPolicy } from "../channels/policy.mjs";
import { createMcpClient } from "../mcp/client.mjs";
import { createMcpServer } from "../mcp/server.mjs";
import { createPairingStore } from "../pairing/pairing-store.mjs";
import { createGatewayAuth } from "./auth.mjs";
import { startRefreshScheduler } from "../connected/refresh-scheduler.mjs";
import { takePending } from "../connected/oauth-pending.mjs";
import { setAppToken } from "../connected/token-store.mjs";
import { ensureDoctorCronJob } from "../cron/doctor-job.mjs";
import { ensureEvalCronJob } from "../cron/eval-job.mjs";
import { startQueueWorker } from "../jobs/queue.mjs";
import { gracefulShutdown } from "./shutdown.mjs";
import { softReloadConfig } from "../config/reload.mjs";
import { resetSharedAlerter } from "../alerting/alerts.mjs";
import { createApprovalGate, getSharedApprovalGate, resetSharedApprovalGate } from "../security/approvals.mjs";
import { start as startCron } from "../cron/scheduler.mjs";


const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Keep in sync with package.json */
const XCLAW_VERSION = "0.7.0";
const XCLAW_PHASE = 7;

function json(res, status, body) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Powered-By": "XClaw-Gateway",
  });
  res.end(data);
}

const MAX_BODY_BYTES = 1_000_000; // 1MB cap — unbounded bodies are a trivial memory DoS

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY_BYTES) {
      req.destroy();
      throw Object.assign(new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`), {
        statusCode: 413,
      });
    }
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  // Browsers hard-refuse ES module imports served without a JS MIME type —
  // octet-stream kills every `import "./x.mjs"` in the UIs.
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

async function serveStatic(res, filePath) {
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

/**
 * Run agent loop and stream every onEvent over SSE, then a final "result" event.
 */

function noteEviction(e, source = "agent") {
  // Live console: approval/security + budget events go to the WS hub so open
  // Control UIs update without polling (pending-approval badge, table).
  if (e?.type === "security" || e?.type === "budget") {
    try {
      wsBroadcast("security", { source, ...e });
    } catch {
      /* hub not attached yet (boot) — fine */
    }
  }
  if (e?.type === "cache" && e?.phase === "eviction") {
    pushEvictionEvent({
      source,
      policy: e.policy,
      actions: Array.isArray(e.actions) ? e.actions.length : e.actions,
      truncated: e.truncated,
      dropped: e.dropped,
      stubbed: e.stubbed,
      totalChars: e.totalChars,
      messageCount: e.messageCount,
      weights: e.weights
        ? {
            wSize: e.weights.wSize,
            wAge: e.weights.wAge,
            pressure: e.weights.pressure,
            skew: e.weights.skew,
            stressed: e.weights.stressed,
            track: e.weights.track,
            emaMode: e.weights.emaMode,
            deadband: e.weights.deadband,
          }
        : null,
    });
  }
}

async function streamAgentRun(req, res, { message, workingDir, cfg, body = {} }) {
  const controller = new AbortController();
  const so = streamOpts(cfg);
  const writer = createStreamWriter(req, res, {
    heartbeatMs: so.heartbeatMs,
  });
  const cleanup = writer.bindAbort(controller);
  const push = (eventName, payload) => {
    if (controller.signal.aborted || !writer.isOpen()) return false;
    return writer.push(eventName, payload);
  };

  const resume = resolveStreamResume(req, body, {
    prefix: "agent",
    capacity: streamOpts(cfg).capacity,
    ttlMs: streamOpts(cfg).ttlMs,
  });

  // Resume-only paths (no new agent loop)
  if (resume.mode === "missing") {
    noteStreamNotFound("agent", resume);
    push("error", {
      type: "error",
      ok: false,
      code: "stream_not_found",
      error: `Unknown streamId: ${resume.streamId}`,
      streamId: resume.streamId,
      lastEventId: resume.lastEventId,
    });
    writer.end();
    cleanup();
    return;
  }

  if (resume.mode === "replay-only") {
    const { replayed, unsubscribe } = attachWriterToLog(resume.log, {
      push,
      lastEventId: resume.lastEventId,
      live: false,
    });
    push("lifecycle", {
      type: "lifecycle",
      phase: "resume",
      stream: writer.mode,
      streamId: resume.streamId,
      resumedFrom: resume.lastEventId,
      replayed,
      status: resume.log.status,
    });
    push("result", {
      type: "result",
      ok: true,
      resumed: true,
      streamId: resume.streamId,
      replayed,
      status: resume.log.status,
    });
    writer.end();
    unsubscribe();
    cleanup();
    return;
  }

  if (resume.mode === "resume-live") {
    // Attach to in-flight run: replay gap + subscribe to live producer events
    const { replayed, unsubscribe } = attachWriterToLog(resume.log, {
      push,
      lastEventId: resume.lastEventId,
      live: true,
    });
    push("lifecycle", {
      type: "lifecycle",
      phase: "resume",
      stream: writer.mode,
      streamId: resume.streamId,
      resumedFrom: resume.lastEventId,
      replayed,
      status: "live",
    });
    // Stay open until run ends or client aborts
    try {
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (controller.signal.aborted || resume.log.status !== "live" || !writer.isOpen()) {
            clearInterval(check);
            resolve();
          }
        }, 200);
        if (typeof check.unref === "function") check.unref();
        controller.signal.addEventListener("abort", () => {
          clearInterval(check);
          resolve();
        }, { once: true });
      });
      if (writer.isOpen()) writer.end();
    } finally {
      unsubscribe();
      cleanup();
    }
    return;
  }

  // New run
  const log = resume.log;
  const produce = createProducer(log, push);

  try {
    produce("lifecycle", {
      type: "lifecycle",
      phase: "start",
      stream: writer.mode,
      streamId: resume.streamId,
    });

    if (!message || typeof message !== "string") {
      produce("error", {
        type: "error",
        ok: false,
        code: "message_required",
        error: "body.message (string) required for new agent runs",
        streamId: resume.streamId,
      });
      log.markEnded("ended");
      writer.end();
      return;
    }

    const result = await runAgentLoop({
      userMessage: message,
      cfg,
      workingDir: workingDir || process.cwd(),
      signal: controller.signal,
      chatSessionId: body?.sessionId || body?.chatSessionId || body?.conversationId || null,
      history: Array.isArray(body?.history)
        ? body.history
        : Array.isArray(body?.messages)
          ? body.messages
          : [],
      onEvent: (e) => {
        noteEviction(e, "agent/stream");
        produce(e.type || "message", e);
      },
    });

    if (!controller.signal.aborted) {
      produce("result", {
        type: "result",
        ok: true,
        text: result.text,
        turns: result.turns,
        model: result.model,
        toolTrace: result.toolTrace,
        usage: result.usage,
        sessionId: result.sessionId,
        suggestions: result.suggestions || [],
        streamId: resume.streamId,
      });
      log.markEnded("ended");
      writer.end();
    } else {
      log.markEnded("aborted");
    }
  } catch (err) {
    const aborted =
      controller.signal.aborted ||
      err.message === "aborted" ||
      err.name === "AbortError";
    if (aborted) {
      console.log(`[xclaw] ${writer.mode} agent stream aborted (client gone)`);
      log.markEnded("aborted");
      if (writer.isOpen()) {
        produce("error", { type: "error", ok: false, error: "aborted", aborted: true });
        writer.end();
      }
    } else {
      produce("error", {
        type: "error",
        ok: false,
        error: err.message || String(err),
      });
      log.markEnded("ended");
      writer.end();
    }
  } finally {
    cleanup();
  }
}


/**
 * WebChat message with SSE: stream events, then result includes session reply.
 * Uses handleWebChatMessage but needs live events — so we duplicate session
 * wiring via runAgentLoop + manual history... Better: stream via onEvent
 * while handleWebChatMessage runs — handleWebChatMessage already supports onEvent.
 */
async function streamSwarmRun(req, res, { body, cfg }) {
  const controller = new AbortController();
  const so = streamOpts(cfg);
  const writer = createStreamWriter(req, res, {
    heartbeatMs: so.heartbeatMs,
  });
  const cleanup = writer.bindAbort(controller);
  let swarmIdSeen = null;
  const push = (eventName, payload) => {
    if (controller.signal.aborted || !writer.isOpen()) return false;
    return writer.push(eventName, payload);
  };

  const bodyObj = body && typeof body === "object" ? body : {};
  const resume = resolveStreamResume(req, bodyObj, {
    prefix: "swarm",
    capacity: streamOpts(cfg).capacity,
    ttlMs: streamOpts(cfg).ttlMs,
  });

  // Custom abort handlers: log + best-effort persist if we already have a swarm id
  const unsubAbortLog = onAbort(
    controller.signal,
    async ({ reason }) => {
      console.log(
        `[xclaw] swarm ${writer.mode} abort handler:`,
        reason?.message || reason || "aborted",
        swarmIdSeen ? `swarmId=${swarmIdSeen}` : ""
      );
      if (swarmIdSeen) {
        try {
          const { updateSwarmRun } = await import("../agents/swarm-store.mjs");
          await updateSwarmRun(cfg, swarmIdSeen, {
            status: "aborted",
            finishedAt: new Date().toISOString(),
            error: String(reason?.message || reason || "sse_client_gone"),
          });
        } catch (e) {
          console.warn("[xclaw] abort persist failed:", e.message || e);
        }
      }
    },
    { label: "swarm-stream-persist", timeoutMs: 5_000 }
  );

  try {
    // —— Resume paths (parity with agent stream) ——
    if (resume.mode === "missing") {
      noteStreamNotFound("swarm", resume);
      push("error", {
        type: "error",
        ok: false,
        code: "stream_not_found",
        error: `Unknown streamId: ${resume.streamId}`,
        streamId: resume.streamId,
        lastEventId: resume.lastEventId,
        kind: "swarm",
      });
      writer.end();
      return;
    }

    if (resume.mode === "replay-only") {
      const { replayed, unsubscribe } = attachWriterToLog(resume.log, {
        push,
        lastEventId: resume.lastEventId,
        live: false,
      });
      push("lifecycle", {
        type: "lifecycle",
        phase: "resume",
        kind: "swarm",
        stream: writer.mode,
        streamId: resume.streamId,
        resumedFrom: resume.lastEventId,
        replayed,
        status: resume.log.status,
      });
      push("result", {
        type: "result",
        ok: true,
        resumed: true,
        kind: "swarm",
        streamId: resume.streamId,
        replayed,
        status: resume.log.status,
      });
      writer.end();
      unsubscribe();
      return;
    }

    if (resume.mode === "resume-live") {
      const { replayed, unsubscribe } = attachWriterToLog(resume.log, {
        push,
        lastEventId: resume.lastEventId,
        live: true,
      });
      push("lifecycle", {
        type: "lifecycle",
        phase: "resume",
        kind: "swarm",
        stream: writer.mode,
        streamId: resume.streamId,
        resumedFrom: resume.lastEventId,
        replayed,
        status: "live",
      });
      try {
        await new Promise((resolve) => {
          const check = setInterval(() => {
            if (
              controller.signal.aborted ||
              resume.log.status !== "live" ||
              !writer.isOpen()
            ) {
              clearInterval(check);
              resolve();
            }
          }, 200);
          if (typeof check.unref === "function") check.unref();
          controller.signal.addEventListener(
            "abort",
            () => {
              clearInterval(check);
              resolve();
            },
            { once: true }
          );
        });
        if (writer.isOpen()) writer.end();
      } finally {
        unsubscribe();
      }
      return;
    }

    // —— New swarm run ——
    const log = resume.log;
    const produce = createProducer(log, push);

    produce("lifecycle", {
      type: "lifecycle",
      phase: "start",
      kind: "swarm",
      stream: writer.mode,
      streamId: resume.streamId,
    });

    const goal = bodyObj.goal || bodyObj.message || "";
    const isResumeOnly =
      bodyObj.resume === true ||
      bodyObj.attach === true ||
      (bodyObj.streamId &&
        (bodyObj.lastEventId || req.headers["last-event-id"]));
    if (!goal && !bodyObj.tasks && !isResumeOnly) {
      produce("error", {
        type: "error",
        ok: false,
        code: "goal_required",
        error: "body.goal or body.tasks required for new swarm runs",
        streamId: resume.streamId,
        kind: "swarm",
      });
      log.markEnded("ended");
      writer.end();
      return;
    }

    const { runSwarmFanOut } = await import("../agents/swarm-run.mjs");
    const result = await runSwarmFanOut(cfg, {
      goal,
      tasks: bodyObj.tasks,
      onDepFail: bodyObj.onDepFail,
      parentId: bodyObj.parentId || bodyObj.sessionId || null,
      vote: bodyObj.vote,
      merge: bodyObj.merge,
      workingDir: bodyObj.workingDir,
      timeoutMs: bodyObj.timeoutMs,
      retries: bodyObj.retries,
      signal: controller.signal,
      onEvent: (e) => {
        if (e.swarmId) swarmIdSeen = e.swarmId;
        noteEviction(e, "swarm/stream");
        const name = e.phase || e.type || "swarm";
        produce(name, e);
      },
    });
    if (result.swarmId) swarmIdSeen = result.swarmId;

    if (controller.signal.aborted || result.status === "aborted") {
      log.markEnded("aborted");
      if (writer.isOpen()) {
        produce("swarm_aborted", {
          type: "swarm",
          phase: "swarm_aborted",
          ok: false,
          aborted: true,
          swarmId: result.swarmId || null,
          status: "aborted",
          streamId: resume.streamId,
          reason: controller.signal.reason
            ? String(
                controller.signal.reason?.message || controller.signal.reason
              )
            : "client_disconnect",
        });
        produce("result", {
          type: "result",
          ok: false,
          aborted: true,
          status: "aborted",
          swarmId: result.swarmId || null,
          streamId: resume.streamId,
          summary: result.summary,
          results: result.results,
        });
        writer.end();
      }
    } else if (result.ok === false && result.code) {
      produce("error", {
        type: "error",
        ok: false,
        code: result.code,
        error: result.error,
        details: result.details,
        streamId: resume.streamId,
      });
      log.markEnded("ended");
      writer.end();
    } else {
      produce("result", {
        type: "result",
        ok: result.ok !== false,
        status: result.status,
        swarmId: result.swarmId,
        streamId: resume.streamId,
        waves: result.waves,
        children: result.children,
        summary: result.summary,
        results: result.results,
        graph: result.graph,
        ascii: result.ascii,
        merge: result.merge,
        vote: result.vote,
      });
      log.markEnded("ended");
      writer.end();
    }
  } catch (err) {
    const aborted =
      controller.signal.aborted ||
      err.message === "aborted" ||
      /abort/i.test(err.message || "") ||
      err.name === "AbortError";
    if (aborted) {
      console.log(`[xclaw] ${writer.mode} swarm stream aborted (client gone)`);
      try {
        const log = resume.log;
        if (log) log.markEnded("aborted");
      } catch {
        /* */
      }
      if (writer.isOpen()) {
        push("swarm_aborted", {
          type: "swarm",
          phase: "swarm_aborted",
          ok: false,
          aborted: true,
          streamId: resume.streamId,
          reason: String(err.message || controller.signal.reason || "aborted"),
        });
        push("error", {
          type: "error",
          ok: false,
          error: "aborted",
          aborted: true,
          streamId: resume.streamId,
        });
        writer.end();
      }
    } else {
      try {
        if (resume.log) resume.log.markEnded("ended");
      } catch {
        /* */
      }
      push("error", {
        type: "error",
        ok: false,
        error: err.message || String(err),
        streamId: resume.streamId,
      });
      writer.end();
    }
  } finally {
    try {
      unsubAbortLog();
    } catch {
      /* */
    }
    cleanup();
  }
}


async function streamWebChatMessage(req, res, { message, sessionId, cfg, mode, verify, body = {} }) {
  const controller = new AbortController();
  const so = streamOpts(cfg);
  const writer = createStreamWriter(req, res, {
    heartbeatMs: so.heartbeatMs,
  });
  const cleanup = writer.bindAbort(controller);
  const push = (eventName, payload) => {
    if (controller.signal.aborted || !writer.isOpen()) return false;
    return writer.push(eventName, payload);
  };

  const bodyObj = body && typeof body === "object" ? body : {};
  const resume = resolveStreamResume(req, bodyObj, {
    prefix: "webchat",
    capacity: streamOpts(cfg).capacity,
    ttlMs: streamOpts(cfg).ttlMs,
  });

  try {
    // —— Resume paths (parity with agent/swarm) ——
    if (resume.mode === "missing") {
      noteStreamNotFound("webchat", resume);
      push("error", {
        type: "error",
        ok: false,
        code: "stream_not_found",
        error: `Unknown streamId: ${resume.streamId}`,
        streamId: resume.streamId,
        lastEventId: resume.lastEventId,
        kind: "webchat",
      });
      writer.end();
      return;
    }

    if (resume.mode === "replay-only") {
      const { replayed, unsubscribe } = attachWriterToLog(resume.log, {
        push,
        lastEventId: resume.lastEventId,
        live: false,
      });
      push("lifecycle", {
        type: "lifecycle",
        phase: "resume",
        kind: "webchat",
        stream: writer.mode,
        streamId: resume.streamId,
        resumedFrom: resume.lastEventId,
        replayed,
        status: resume.log.status,
      });
      push("result", {
        type: "result",
        ok: true,
        resumed: true,
        kind: "webchat",
        streamId: resume.streamId,
        replayed,
        status: resume.log.status,
      });
      writer.end();
      unsubscribe();
      return;
    }

    if (resume.mode === "resume-live") {
      const { replayed, unsubscribe } = attachWriterToLog(resume.log, {
        push,
        lastEventId: resume.lastEventId,
        live: true,
      });
      push("lifecycle", {
        type: "lifecycle",
        phase: "resume",
        kind: "webchat",
        stream: writer.mode,
        streamId: resume.streamId,
        resumedFrom: resume.lastEventId,
        replayed,
        status: "live",
      });
      try {
        await new Promise((resolve) => {
          const check = setInterval(() => {
            if (
              controller.signal.aborted ||
              resume.log.status !== "live" ||
              !writer.isOpen()
            ) {
              clearInterval(check);
              resolve();
            }
          }, 200);
          if (typeof check.unref === "function") check.unref();
          controller.signal.addEventListener(
            "abort",
            () => {
              clearInterval(check);
              resolve();
            },
            { once: true }
          );
        });
        if (writer.isOpen()) writer.end();
      } finally {
        unsubscribe();
      }
      return;
    }

    // —— New webchat message stream ——
    const log = resume.log;
    const produce = createProducer(log, push);

    produce("lifecycle", {
      type: "lifecycle",
      phase: "start",
      kind: "webchat",
      stream: writer.mode,
      streamId: resume.streamId,
      chatSessionId: sessionId || null,
    });

    if (!message || typeof message !== "string") {
      produce("error", {
        type: "error",
        ok: false,
        code: "message_required",
        error: "body.message (string) required for new webchat streams",
        streamId: resume.streamId,
        kind: "webchat",
      });
      log.markEnded("ended");
      writer.end();
      return;
    }

    const out = await handleWebChatMessage({
      sessionId,
      message,
      cfg,
      mode,
      verify,
      signal: controller.signal,
      onEvent: (e) => {
        noteEviction(e, "webchat/stream");
        produce(e.type || "message", e);
      },
    });

    if (!controller.signal.aborted) {
      produce("result", {
        type: "result",
        ok: true,
        sessionId: out.sessionId,
        reply: out.reply,
        text: out.reply?.content,
        turns: out.turns,
        model: out.model,
        usage: out.usage,
        job: out.job,
        suggestions: out.suggestions || out.reply?.suggestions || [],
        turnState: out.turnState || out.reply?.turnState || null,
        streamId: resume.streamId,
      });
      log.markEnded("ended");
      writer.end();
    } else {
      log.markEnded("aborted");
    }
  } catch (err) {
    const aborted =
      controller.signal.aborted ||
      err.message === "aborted" ||
      err.name === "AbortError";
    if (aborted) {
      console.log(`[xclaw] ${writer.mode} webchat stream aborted (client gone)`);
      try {
        if (resume.log) resume.log.markEnded("aborted");
      } catch {
        /* */
      }
      if (writer.isOpen()) {
        push("error", {
          type: "error",
          ok: false,
          error: "aborted",
          aborted: true,
          streamId: resume.streamId,
          kind: "webchat",
        });
        writer.end();
      }
    } else {
      try {
        if (resume.log) resume.log.markEnded("ended");
      } catch {
        /* */
      }
      push("error", {
        type: "error",
        ok: false,
        error: err.message || String(err),
        streamId: resume.streamId,
        kind: "webchat",
      });
      writer.end();
    }
  } finally {
    cleanup();
  }
}

export async function startGateway({ root } = {}) {
  const cfg = await loadConfig();
  const uiRoot = path.join(root, "ui", "webchat");
  const controlRoot = path.join(root, "ui", "control");

  console.log(`[xclaw] XClaw Gateway starting (Phase 7 · hardening)…`);
  console.log(`[xclaw] Config: ${cfg.paths.configFile}`);

  // Config-driven commit gates: consumers (browser hooks, fabric, doctor,
  // computer child via env inheritance) all read XCLAW_COMMIT_GATES — export
  // it from config here so the knob is declarative. Env always wins.
  if (cfg.security?.commitGates && process.env.XCLAW_COMMIT_GATES == null) {
    process.env.XCLAW_COMMIT_GATES = "1";
    console.log(`[xclaw] commit gates enabled (security.commitGates)`);
  }

  if (cfg.computer.autoStart) {
    try {
      await startComputer({ root, foreground: false });
    } catch (err) {
      console.error(`[xclaw] Computer start failed: ${err.message}`);
    }
  }

  const webchatEnabled = cfg.channels?.webchat?.enabled !== false;

  const channelManager = createChannelManager(cfg);
  await channelManager.startAll();
  try {
    configureSubagentPersistence(cfg);
    // Missions interrupted by a crash/restart become resumable, never lost.
    import("../missions/store.mjs")
      .then((m) => m.reconcileInterrupted(cfg))
      .then((ids) => {
        if (ids.length) {
          console.log(`[xclaw:missions] marked ${ids.length} interrupted mission(s) resumable: ${ids.join(", ")}`);
        }
      })
      .catch(() => {});
    // long-run objectives: running → interrupted at boot; they auto-resume on
    // the owner's next message in that chat (or /objective resume)
    import("../agent/objective-store.mjs")
      .then((m) => m.reconcileInterruptedObjectives(cfg))
      .then((ids) => {
        if (ids.length) {
          console.log(`[xclaw:objectives] marked ${ids.length} interrupted objective(s) resumable: ${ids.join(", ")}`);
        }
      })
      .catch(() => {});
  } catch (e) {
    console.warn("[xclaw] subagent persistence:", e.message);
  }
  // P5 proactive token refresh
  if (cfg.connected?.refreshScheduler !== false) {
    try {
      startRefreshScheduler(cfg, {
        intervalMs: cfg.connected?.refreshIntervalMs,
      });
      console.log("[xclaw] connected token refresh scheduler started");
    try {
      const { hydrateAutomations } = await import("../automations/index.mjs");
      const h = hydrateAutomations(cfg);
      console.log(`[xclaw] automations hydrated: ${h.count}`);
    } catch (autoErr) {
      console.error("[xclaw] automations hydrate:", autoErr?.message || autoErr);
    }
    } catch (e) {
      console.error("[xclaw] refresh scheduler:", e.message);
    }
  }
  startCron();
  if (cfg.doctor?.cron?.enabled !== false) {
    const everyMs = cfg.doctor?.cron?.everyMs ?? 3_600_000;
    const docJob = ensureDoctorCronJob({
      cfg,
      channelManager,
      isComputerRunning,
      everyMs,
      enabled: cfg.doctor?.cron?.enabled !== false,
      notifyOnFail: cfg.doctor?.cron?.notifyOnFail !== false,
      notifyOnOk: cfg.doctor?.cron?.notifyOnOk === true,
      delivery: cfg.doctor?.cron?.delivery || null,
      logPath: cfg.doctor?.cron?.logPath,
    });
    console.log(`[xclaw] doctor cron every ${everyMs}ms id=${docJob.id}`);
  }

  if (cfg.eval?.cron?.enabled !== false) {
    try {
      const ej = ensureEvalCronJob({ cfg });
      console.log(`[xclaw] eval cron every ${ej.everyMs || cfg.eval?.cron?.everyMs || 86400000}ms id=${ej.id}`);
    } catch (err) {
      console.warn("[xclaw] eval cron:", err.message);
    }
  }
  try {
    startQueueWorker(cfg);
  try {
    const { startSloMonitor } = await import("../ops/slo-monitor.mjs");
    startSloMonitor(cfg);
  } catch (e) {
    console.warn("[xclaw] slo monitor", e.message);
  }

  if (cfg.security?.digestIntervalMs) {
    const iv = setInterval(() => {
      import("../security/approval-digest.mjs")
        .then(({ sendApprovalDigest }) => sendApprovalDigest(cfg))
        .catch((e) => console.warn("[xclaw:digest]", e.message));
    }, cfg.security.digestIntervalMs);
    if (iv.unref) iv.unref();
    console.log(`[xclaw] approval digest every ${cfg.security.digestIntervalMs}ms`);
  }
  try {
    startComputerWatchdog(cfg, { root });
  } catch (err) {
    console.warn("[xclaw] computer watchdog:", err.message);
  }
  try {
    // Daily stale-tmp sweep (age-gated, mission-worktree-safe) — a live host
    // accumulated 10k+ /tmp/xclaw-* entries from suite runs before this
    // existed. Off via ops.tmpSweep.enabled: false.
    if (cfg.ops?.tmpSweep?.enabled !== false || cfg.ops?.maintenance?.enabled !== false) {
      const sweepEveryMs = Math.max(3_600_000, Number(cfg.ops?.maintenance?.intervalMs) || Number(cfg.ops?.tmpSweep?.intervalMs) || 24 * 3600 * 1000);
      const sweepTimer = setInterval(() => {
        if (cfg.ops?.tmpSweep?.enabled !== false) {
          import("../ops/tmp-sweeper.mjs")
            .then((m) => m.sweepStaleTmp(cfg))
            .then((r) => {
              if (r.removed.length) console.log(`[xclaw:ops] tmp sweep: removed ${r.removed.length} stale entries`);
            })
            .catch((e) => console.warn("[xclaw:ops] tmp sweep failed:", e?.message || e));
        }
        // ledger compaction + append-only rotation (audit's deferred finding)
        import("../ops/maintenance.mjs")
          .then((m) => m.runOpsMaintenance(cfg))
          .then((r) => {
            if (r.skipped) return;
            if (r.ledger?.removed?.length) console.log(`[xclaw:ops] ledger compact: removed ${r.ledger.removed.length} segments`);
            for (const rot of r.rotated) console.log(`[xclaw:ops] rotated ${rot.path} (${rot.bytes} → ${rot.keptBytes} bytes)`);
            for (const e of r.errors) console.warn(`[xclaw:ops] maintenance ${e.target}:`, e.error);
          })
          .catch((e) => console.warn("[xclaw:ops] maintenance failed:", e?.message || e));
      }, sweepEveryMs);
      if (sweepTimer.unref) sweepTimer.unref();
    }
    startChannelHealthWatchdog(cfg, channelManager, {
      // outage/recovery events reach live Control surfaces
      onEvent: (e) => {
        try {
          wsBroadcast("security", e);
        } catch {
          /* hub optional */
        }
      },
    });
  } catch (err) {
    console.warn("[xclaw] channel health watchdog:", err.message);
  }
  try {
    const hb = ensureHeartbeat(cfg);
    if (hb.enabled) {
      console.log(`[xclaw] autonomy heartbeat every ${hb.everyMs}ms job=${hb.jobId}`);
    }
  } catch (err) {
    console.warn("[xclaw] heartbeat:", err.message);
  }
  } catch (err) {
    console.warn("[xclaw] job queue worker:", err.message);
  }

  const channelPolicy = createChannelPolicy(cfg);
  const approvalGate = resetSharedApprovalGate(cfg);
  const mcpClient = createMcpClient({ getServers: () => cfg.mcp?.servers || [], cfg });
  const mcpServer = createMcpServer({ cfg });
  const pairingStore = createPairingStore({});
  const gatewayAuth = createGatewayAuth(cfg);
  resetSharedAlerter(cfg);



  if (cfg.tokens?.probeOnStart !== false && cfg.tokens?.enabled !== false) {
    try {
      const { probeTokenizerRuntime } = await import("../tokens/probes.mjs");
      const probeResult = await probeTokenizerRuntime(cfg, cfg.agent?.model || "gpt-4o-mini", {
        baseUrl: cfg.agent?.baseUrl,
      });
      const pr = probeResult.probe;
      console.log(
        `[xclaw] Token probe: encoding=${pr.encoding} mode=${probeResult.tokenizer.mode} ok=${pr.ok} · ${pr.recommendation}`
      );
      if (cfg.tokens?.calibrateOnStart && pr.calibration?.suggested) {
        const { applyProbeCalibration } = await import("../tokens/probes.mjs");
        const { cfg: newTok, applied } = applyProbeCalibration(cfg.tokens, pr);
        if (applied) {
          cfg.tokens = { ...cfg.tokens, ...newTok };
          console.log(
            `[xclaw] Token calibration applied: prose=${newTok.proseCharsPerToken} code=${newTok.codeCharsPerToken}`
          );
        }
      }
    } catch (err) {
      console.warn(`[xclaw] Token probe skipped: ${err.message}`);
    }
  }


  const { server, tls: tlsOn } = createHttpServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${cfg.gateway.host}`);
    let p = url.pathname;
    // API versioning: /v1/<route> is an alias for every route (clients can pin
    // a version prefix today; a breaking v2 surface can then coexist later).
    if (p === "/v1" || p.startsWith("/v1/")) {
      p = p.slice(3) || "/";
      res.setHeader("X-XClaw-Api-Version", "1");
    }
    // CORS decided once per request (loopback-reflect by default, wildcard only
    // when cfg.gateway.corsOrigin === "*"); writeHead calls must not set ACAO.
    applyCors(req, res, cfg);
      if (gatewayAuth.isProtectedPath(p) && req.method !== "OPTIONS") {
        const auth = gatewayAuth.check(req);
        if (!auth.ok) return json(res, 401, { error: "unauthorized" });
      }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-xclaw-token",
      });
      return res.end();
    }

    try {
      const routeArgs = { p, method: req.method, req, res, url, cfg, json, readBody };
      // Mechanical route groups live in ./routes/* (one tryHandle per module);
      // stream/SSE, WebChat/static, OAuth-callback, telegram, and /agent/run
      // handlers stay inline — they own writer/closure state.
      if (await tryHandleProvidersRoute(routeArgs)) return;
      if (await tryHandleChannelsRoute({ ...routeArgs, channelManager })) return;
      if (await tryHandleAlertsRoute({ ...routeArgs, channelManager })) return;
      if (await tryHandleOpsRoute({ ...routeArgs, root, webchatEnabled, channelManager, XCLAW_VERSION, XCLAW_PHASE })) return;
      if (await tryHandleLedgerRoute(routeArgs)) return;
      if (await tryHandleEvalQueueRoute({ ...routeArgs, root })) return;
      if (await tryHandleJwksRoute(routeArgs)) return;
      if (await tryHandleTokensRoute(routeArgs)) return;
      if (await tryHandleSessionsRoute(routeArgs)) return;
      if (await tryHandleSubagentsRoute(routeArgs)) return;
      if (await tryHandleMcpRoute({ ...routeArgs, mcpClient, mcpServer })) return;
      if (await tryHandleMediaRoute(routeArgs)) return;
      if (await tryHandleHooksRoute(routeArgs)) return;
      if (await tryHandleMissionsRoute(routeArgs)) return;
      if (await tryHandleObjectivesRoute(routeArgs)) return;
      if (await tryHandlePointRoute(routeArgs)) return;
      if (await tryHandleCompletionRoute(routeArgs)) return;














            if (p === "/events/eviction/stream" && req.method === "GET") {
        const lastEventId =
          req.headers["last-event-id"] ||
          url.searchParams.get("lastEventId") ||
          url.searchParams.get("last-event-id") ||
          null;
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
                "X-Accel-Buffering": "no",
        });
        res.write(": eviction stream\n\n");
        subscribeEvictionSSE(res, { lastEventId });
        const ping = setInterval(() => {
          if (res.writableEnded) return clearInterval(ping);
          try {
            res.write(`: ping ${Date.now()}\n\n`);
          } catch {
            clearInterval(ping);
          }
        }, 15000);
        req.on("close", () => clearInterval(ping));
        return;
      }




      // --- Swarm first-class HTTP API (Phase D) ---
      if (p === "/swarm/run" && req.method === "POST") {
        const body = await readBody(req).catch(() => ({}));
        const { runSwarmFanOut } = await import("../agents/swarm-run.mjs");
        try {
          const result = await runSwarmFanOut(cfg, {
            goal: body.goal || body.message || "",
            tasks: body.tasks,
            onDepFail: body.onDepFail,
            parentId: body.parentId || body.sessionId || null,
            vote: body.vote,
            merge: body.merge,
          });
          const status = result.ok === false ? 422 : 200;
          return json(res, status, result);
        } catch (err) {
          return json(res, 500, {
            ok: false,
            error: err.message || String(err),
            code: "SWARM_HTTP_ERROR",
          });
        }
      }

      if (p === "/swarm/run/stream" && req.method === "POST") {
        const body = await readBody(req).catch(() => ({}));
        if (!body.tasks && !body.goal && !body.message) {
          return json(res, 400, {
            error: "body.tasks (array) or body.goal required",
          });
        }
        return streamSwarmRun(req, res, { body, cfg });
      }

      if (p === "/swarm" && req.method === "GET") {
        const { listSwarmRuns } = await import("../agents/swarm-store.mjs");
        const limit = Number(url.searchParams.get("limit") || 30);
        const items = await listSwarmRuns(cfg, { limit });
        return json(res, 200, { count: items.length, runs: items });
      }

      // /swarm read + merge-approval routes served by routes/swarm.mjs;
      // /swarm/run + /swarm/run/stream POST stay inline above (SSE closures).
      if (p === "/swarm/merges" || p.startsWith("/swarm/")) {
        const handled = await tryHandleSwarmRoute({
          p,
          method: req.method,
          req,
          res,
          url,
          cfg,
          json,
          readBody,
        });
        if (handled) return;
      }


      // --- Agent: JSON (sync) ---
      if (p === "/agent/run" && req.method === "POST") {
        const body = await readBody(req);
        const message = body.message || body.prompt || body.text;
        if (!message || typeof message !== "string") {
          return json(res, 400, { error: "body.message (string) required" });
        }
        const events = [];
        try {
          const result = await runAgentLoop({
            userMessage: message,
            cfg,
            workingDir: body.workingDir || process.cwd(),
            chatSessionId: body.sessionId || body.chatSessionId || body.conversationId || null,
            history: Array.isArray(body.history)
              ? body.history
              : Array.isArray(body.messages)
                ? body.messages
                : [],
            onEvent: (e) => {
              noteEviction(e, "agent/run");
              events.push({ ...e, at: Date.now() });
              if (body.verbose) console.log(`[agent]`, e.type, e.phase || "", e.name || "");
            },
          });
          return json(res, 200, {
            ok: true,
            ...result,
            events: body.includeEvents ? events : undefined,
          });
        } catch (err) {
          return json(res, 500, {
            ok: false,
            error: err.message || String(err),
            events: body.includeEvents ? events : undefined,
          });
        }
      }

      // --- Agent: SSE stream ---
      if (p === "/agent/run/stream" && req.method === "POST") {
        const body = await readBody(req);
        const message = body.message || body.prompt || body.text;
        // Allow resume without message when streamId is present
        const isResume =
          body.resume === true ||
          body.attach === true ||
          (body.streamId && (body.lastEventId || req.headers["last-event-id"]));
        if ((!message || typeof message !== "string") && !isResume) {
          return json(res, 400, { error: "body.message (string) required" });
        }
        return streamAgentRun(req, res, {
          message,
          workingDir: body.workingDir,
          cfg,
          body,
        });
      }

      // --- Telegram webhook (always registered; handler checks enabled) ---
      if (p === "/channel/telegram/webhook" && req.method === "POST") {
        const tg = channelManager.get("telegram");
        if (!tg?.enabled) return json(res, 503, { error: "telegram_disabled" });
        let body = {};
        try {
          body = await readBody(req);
          if (typeof body === "string") body = JSON.parse(body || "{}");
        } catch {
          return json(res, 400, { error: "invalid_json" });
        }
        const result = await tg.handleWebhookRequest(req, body);
        if (!result.ok) return json(res, 401, { error: result.reason || "unauthorized" });
        return json(res, 200, { ok: true });
      }

      // --- WebChat ---
      if (webchatEnabled) {
        if (p === "/channel/webchat/suggestions/feedback" && req.method === "POST") {
          const body = await readBody(req);
          try {
            const { recordDurableSuggestionFeedback } = await import("../agent/suggestion-feedback.mjs");
            const { recordSuggestionTapMetric } = await import("../agent/agent-metrics.mjs");
            await recordDurableSuggestionFeedback(cfg, {
              event: body.event || "shown",
              source: body.source,
              kind: body.kind,
              prompt: body.prompt,
              suggestionId: body.suggestionId,
              userId: body.sessionId || body.userId || "webchat",
              chatId: body.sessionId,
            });
            if (body.event === "tapped") {
              try { recordSuggestionTapMetric(); } catch { /* */ }
            }
            return json(res, 200, { ok: true });
          } catch (err) {
            return json(res, 500, { ok: false, error: err.message || String(err) });
          }
        }

        if (p === "/channel/webchat/message" && req.method === "POST") {
          const body = await readBody(req);
          try {
            const out = await handleWebChatMessage({
              sessionId: body.sessionId,
              message: body.message,
              cfg,
              mode: body.mode,
              verify: body.verify,
              onEvent: (e) => {
                noteEviction(e, "webchat");
                if (body.verbose) console.log(`[webchat]`, e.type, e.phase || "", e.name || "");
              },
            });
            return json(res, 200, {
              ok: true,
              sessionId: out.sessionId,
              reply: out.reply,
              text: out.reply.content,
              turns: out.turns,
              model: out.model,
              usage: out.usage,
              job: out.job,
              suggestions: out.suggestions || [],
              turnState: out.turnState || null,
              events: body.includeEvents ? out.events : undefined,
            });
          } catch (err) {
            return json(res, 500, { ok: false, error: err.message || String(err) });
          }
        }

        // WebChat stream (SSE or NDJSON + Last-Event-ID resume)
        if (p === "/channel/webchat/message/stream" && req.method === "POST") {
          const body = await readBody(req);
          const isResume =
            body.resume === true ||
            body.attach === true ||
            (body.streamId &&
              (body.lastEventId || req.headers["last-event-id"]));
          if ((!body.message || typeof body.message !== "string") && !isResume) {
            return json(res, 400, { error: "body.message (string) required" });
          }
          return streamWebChatMessage(req, res, {
            message: body.message,
            sessionId: body.sessionId,
            mode: body.mode,
            verify: body.verify,
            cfg,
            body,
          });
        }

        if (p === "/channel/webchat/history" && req.method === "GET") {
          const sid = url.searchParams.get("sessionId");
          if (!sid) return json(res, 400, { error: "sessionId query required" });
          const hist = getHistory(sid);
          if (!hist) return json(res, 404, { error: "session not found" });
          return json(res, 200, hist);
        }

        
      
      // P5 gateway OAuth callback (PKCE pending exchange)
      if ((p === "/oauth/callback" || p === "/auth/callback") && req.method === "GET") {
        const u = new URL(req.url || "/", "http://local");
        const state = u.searchParams.get("state");
        const code = u.searchParams.get("code");
        const err = u.searchParams.get("error");
        if (err) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<h1>OAuth error</h1><p>${err}</p>`);
          return;
        }
        if (!state || !code) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("missing state or code");
          return;
        }
        const pending = await takePending(cfg, state);
        if (!pending) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>Unknown or expired OAuth state</h1><p>Retry login from CLI.</p>");
          return;
        }
        try {
          const body = new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: pending.redirectUri,
            client_id: pending.clientId,
            code_verifier: pending.verifier,
          });
          if (pending.clientSecret) body.set("client_secret", pending.clientSecret);
          const tokenRes = await fetch(pending.tokenUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body,
            signal: AbortSignal.timeout(60_000),
          });
          const json = await tokenRes.json().catch(() => ({}));
          if (!tokenRes.ok || !json.access_token) {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end(`<h1>Token exchange failed</h1><pre>${JSON.stringify(json).slice(0, 500)}</pre>`);
            return;
          }
          const expiresAt =
            json.expires_in != null
              ? new Date(Date.now() + Number(json.expires_in) * 1000).toISOString()
              : null;
          await setAppToken(cfg, pending.appId, {
            accessToken: json.access_token,
            refreshToken: json.refresh_token || null,
            expiresAt,
            tokenType: json.token_type || "Bearer",
            scope: json.scope || pending.scope,
            clientId: pending.clientId,
            source: "oauth_gateway_callback",
          });
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            `<html><body style="font-family:system-ui;padding:2rem"><h1>XClaw OAuth OK</h1><p>Connected <b>${pending.appId}</b>. You can close this window.</p></body></html>`
          );
        } catch (e) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end(e.message || String(e));
        }
        return;
      }

// Artifacts browser (P3.4)
      if (p === "/artifacts/list" && req.method === "GET") {
        const workspace = cfg.agent?.workingDir || cfg.workspace || process.cwd();
        const listing = await listArtifacts(workspace);
        return json(res, 200, listing);
      }
      // Inline artifact bytes for the webchat UI (images etc.) — strict
      // workspace containment + extension allowlist (src/gateway/artifact-file.mjs)
      if (p === "/artifacts/file" && req.method === "GET") {
        const { resolveArtifactFile } = await import("./artifact-file.mjs");
        const roots = [
          cfg.paths?.workspaces,
          cfg.agent?.workingDir || cfg.workspace || process.cwd(),
        ].filter(Boolean);
        const rf = await resolveArtifactFile(roots, url.searchParams.get("path"));
        if (!rf.ok) {
          const code = rf.code === "not_found" ? 404 : rf.code === "type_not_allowed" ? 415 : 400;
          return json(res, code, { error: rf.error, code: rf.code });
        }
        const data = await fs.readFile(rf.abs);
        res.writeHead(200, {
          "Content-Type": rf.mime,
          "Content-Length": data.length,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(data);
        return;
      }
      if (p === "/artifacts" || p === "/artifacts/") {
        const htmlPath = path.join(root, "ui", "artifacts", "index.html");
        const html = await fs.readFile(htmlPath, "utf8").catch(() => "<h1>artifacts UI missing</h1>");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (p === "/channel/webchat/sessions" && req.method === "GET") {
          return json(res, 200, { sessions: listChatSessions() });
        }

        if (p === "/channel/webchat/sessions" && req.method === "POST") {
          const body = await readBody(req).catch(() => ({}));
          const s = createChatSession({ workingDir: body.workingDir });
          return json(res, 200, { sessionId: s.id, createdAt: s.createdAt });
        }

        if (p === "/control" || p === "/control/") {
          return serveStatic(res, path.join(controlRoot, "index.html"));
        }
        if (p.startsWith("/control/")) {
          const rel = p.slice("/control/".length) || "index.html";
          const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
          return serveStatic(res, path.join(controlRoot, safe));
        }

        if (p === "/" || p === "/chat" || p === "/chat/") {
          return serveStatic(res, path.join(uiRoot, "index.html"));
        }
        if (p.startsWith("/chat/")) {
          const rel = p.slice("/chat/".length) || "index.html";
          const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
          return serveStatic(res, path.join(uiRoot, safe));
        }
      }



      // /security/* + /pairing/* served by the routes module (richer than the
      // old inline handlers: SLA stats, allow-always decision parsing, engine
      // snapshot; pairing store list/approve/revoke).
      if (p.startsWith("/security/") || p.startsWith("/pairing/")) {
        const handled = await tryHandleSecurityRoute({
          p,
          method: req.method,
          req,
          res,
          cfg,
          approvalGate,
          json,
          readBody,
        });
        if (handled) return;
      }


      // /cron scheduler routes served by routes/cron.mjs (/cron/eval stays inline).
      if (p.startsWith("/cron/") && p !== "/cron/eval" && p !== "/cron/eval/run") {
        const handled = await tryHandleCronRoute({
          p,
          method: req.method,
          req,
          res,
          url,
          cfg,
          json,
          readBody,
        });
        if (handled) return;
      }



      json(res, 404, { error: "not found", path: p });
    } catch (err) {
      if (!res.headersSent) {
        json(res, 500, { error: err.message || String(err) });
      } else if (!res.writableEnded) {
        sendSSE(res, "error", { error: err.message || String(err) });
        res.end();
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.listen(cfg.gateway.port, cfg.gateway.host, (err) =>
      err ? reject(err) : resolve()
    );
  });

  const proto = tlsOn ? "https" : "http";
  console.log(`[xclaw] Gateway listening on ${proto}://${cfg.gateway.host}:${cfg.gateway.port}`);
  const wsHub = attachWebSocketHub(server, {
    path: cfg.gateway?.wsPath || "/ws/events",
    heartbeatMs: cfg.gateway?.wsHeartbeatMs || 25_000,
    // Reject unauthorized upgrades whenever a token is set or requireAuth (prod)
    authorize: (req) => gatewayAuth.authorizeWebSocket(req),
  });
  // global broadcast for optional callers
  globalThis.__xclawWsBroadcast = wsBroadcast;
  console.log(`[xclaw] WebSocket: ${proto === "https" ? "wss" : "ws"}://${cfg.gateway.host}:${cfg.gateway.port}${wsHub.path}`);
  console.log(`[xclaw] Computer at http://${cfg.computer.host}:${cfg.computer.port}`);
  if (webchatEnabled) {
    console.log(`[xclaw] WebChat UI: http://${cfg.gateway.host}:${cfg.gateway.port}/chat/`);
  }
  console.log(`[xclaw] Control UI: http://${cfg.gateway.host}:${cfg.gateway.port}/control/`);
  console.log(`[xclaw] Stream: POST /agent/run/stream (SSE|NDJSON) · POST /swarm/run/stream (SSE|NDJSON) · POST /channel/webchat/message/stream (SSE|NDJSON)`);
  console.log(`[xclaw] WS:  /ws/events (subscribe admission|queue|eviction|swarm|all)`);

  let shuttingDown = false;
  const shutdown = async (signal = "signal") => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[xclaw] Shutting down (${signal})…`);
    try {
      await gracefulShutdown(cfg, { timeoutMs: cfg.shutdown?.drainMs ?? 15_000 });
    } catch (err) {
      console.warn("[xclaw] queue drain:", err.message);
    }
    try {
      server.close();
    } catch {}
    try {
      await channelManager.stopAll();
    } catch {}
    try {
      try { stopComputerWatchdog(); } catch {}
    await stopComputer();
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGHUP", () => {
    void softReloadConfig(cfg)
      .then((r) => {
        console.log(`[xclaw] config reloaded (SIGHUP) changed=${r.changed.join(",") || "none"} profile=${r.profile}`);
      })
      .catch((err) => console.warn("[xclaw] config reload failed:", err.message));
  });

  await new Promise(() => {});
}
