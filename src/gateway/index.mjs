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
import { tryHandleStopRoute } from "./routes/stop.mjs";
import { tryHandleSubagentsRoute } from "./routes/subagents.mjs";
import { tryHandleMcpRoute } from "./routes/mcp.mjs";
import { tryHandleMediaRoute } from "./routes/media.mjs";
import { tryHandleVoiceRoute } from "./routes/voice.mjs";
import { tryHandleOAuthCallbackRoute } from "./routes/oauth-callback.mjs";
import { tryHandleArtifactsRoute } from "./routes/artifacts.mjs";
import { tryHandleApprovalsRoute } from "./routes/approvals.mjs";
import { tryHandleAgentRunRoute } from "./routes/agent-run.mjs";
import { tryHandleSwarmGoalsRoute } from "./routes/swarm-goals.mjs";
import { tryHandleHooksRoute } from "./routes/hooks.mjs";
import { tryHandleMissionsRoute } from "./routes/missions.mjs";
import { tryHandleObjectivesRoute } from "./routes/objectives.mjs";
import { tryHandlePointRoute } from "./routes/point.mjs";
import { tryHandleCompletionRoute } from "./routes/completion.mjs";
import { tryHandleProvidersRoute } from "./routes/providers.mjs";
import { tryHandleChannelsRoute } from "./routes/channels.mjs";
import { applyCors } from "./cors.mjs";
import { assertBindSafety } from "./bind-guard.mjs";
import { resolveGatewayBindHost, startGatewayTailscaleExposure } from "../net/tailscale.mjs";
import { attachWebSocketHub, broadcast as wsBroadcast } from "./ws-hub.mjs";
import { attachVoiceWebSocket } from "./voice-ws.mjs";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config/load.mjs";
import {
  startComputer,
  isComputerRunning,
  stopComputer,
} from "../computer/manager.mjs";
import { startComputerWatchdog, stopComputerWatchdog } from "../computer/watchdog.mjs";
import { proxyComputerRequest, isComputerProxyEnabled } from "./computer-proxy.mjs";
import {
  startChannelHealthWatchdog,
  stopChannelHealthWatchdog,
} from "../channels/health-watchdog.mjs";
import { runAgentLoop } from "../agent/loop.mjs";
import {
  handleWebChatMessage,
  getHistory,
  listChatSessions,
  createChatSession,
} from "../channels/webchat/index.mjs";
import { initSSE, sendSSE, closeSSE, isSSEOpen, bindSSEAbort, onAbort, createStreamWriter, prefersNdjson } from "./sse.mjs";
import { createLiveStreamWriter } from "./sse-live.mjs";
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
import { getControlPlane, stopControlPlane } from "../state/control-plane.mjs";
import { stopAgentStores } from "../state/agent-store.mjs";
import { createGatewayAuth, stripApiVersion } from "./auth.mjs";
import { matchUiRoute, isWebchatEnabled } from "./ui-routes.mjs";
import { startRefreshScheduler } from "../connected/refresh-scheduler.mjs";
import { ensureDoctorCronJob } from "../cron/doctor-job.mjs";
import { ensureApprovalDigestCronJob } from "../cron/approval-digest-job.mjs";
import { ensureEvalCronJob } from "../cron/eval-job.mjs";
import { startQueueWorker } from "../jobs/queue.mjs";
import { gracefulShutdown } from "./shutdown.mjs";
import { softReloadConfig } from "../config/reload.mjs";
import { resetSharedAlerter } from "../alerting/alerts.mjs";
import { createApprovalGate, getSharedApprovalGate, resetSharedApprovalGate } from "../security/approvals.mjs";
import { scheduleJob, cancelJob, listJobs, addJob, run as runCronJob, status as cronStatus, start as startCron, stop as stopCron, getJob } from "../cron/scheduler.mjs";
import { clientErrorStatus } from "../shared/http-error.mjs";


const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Single source of truth: package.json. This used to be a hardcoded literal
 * with a "keep in sync" comment, and it drifted — the gateway, Control UI,
 * WebChat and /info all reported 0.7.0 while the package was on 3.x.
 */
const XCLAW_VERSION = (() => {
  try {
    return (
      JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"))
        .version || "0.0.0"
    );
  } catch {
    return "0.0.0";
  }
})();
const XCLAW_PHASE = 7;

/**
 * A missing API token means PagerDuty was never wired up — a configuration
 * state, not an upstream fault. Answering 502 made an optional, unconfigured
 * integration look like a broken gateway and logged a console error in the
 * Control UI on every click.
 */
function pdStatus(out) {
  if (out?.ok) return 200;
  const reason = String(out?.reason || out?.error || "");
  return /no_api_token|not_configured|missing_token|disabled/i.test(reason) ? 200 : 502;
}

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
  const writer = createLiveStreamWriter(req, res, {
    heartbeatMs: so.heartbeatMs,
    prefix: "agent",
    sessionId: body.sessionId,
    jobId: body.jobId,
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
      // Stream endpoint: prefer token deltas so the TUI can paint live.
      stream: true,
      // TUI Shift+Tab overlay: tighten this run only. Never loosens the
      // machine flag. `ask` → every tool pends; `auto` → drop bypass but
      // keep autoApprove; `bypass` / omitted → honour cfg as-is.
      forceHuman: body?.forceHuman === true,
      ignoreBypass: body?.ignoreBypass === true,
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
  const writer = createLiveStreamWriter(req, res, {
    heartbeatMs: so.heartbeatMs,
    prefix: "swarm",
    sessionId: body.sessionId || body.swarmId,
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
  const writer = createLiveStreamWriter(req, res, {
    heartbeatMs: so.heartbeatMs,
    prefix: "webchat",
    sessionId,
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

/**
 * §13.3 harness adoption, default OFF: only `gateway.runLoop: true` in
 * config hands lifecycle + signals to the §13.2 run-loop (single-instance
 * lock, SIGUSR1 same-pid restart, crash-loop backoff). With the flag
 * absent — every existing deploy — startGateway behaves exactly as before.
 */
async function startGatewaySupervised({ root, cfg }) {
  const os = await import("node:os");
  const { runGatewayLoop } = await import("./run-loop.mjs");
  const { applyCrashLoopGuard } = await import("./crash-guard.mjs");
  const stateRoot = path.join(os.homedir(), ".xclaw");
  const guard = applyCrashLoopGuard(stateRoot);
  if (guard.delayMs) {
    console.log(`[xclaw] crash-loop backoff: waiting ${guard.delayMs}ms before start`);
    await new Promise((r) => setTimeout(r, guard.delayMs));
  }
  console.log(`[xclaw] supervised run-loop enabled (gateway.runLoop)`);
  return runGatewayLoop({
    start: async () => {
      const handle = await startGateway({ root, harness: true });
      guard.clear();
      return handle;
    },
    stop: ({ reason, server }) => server?.stop?.(reason),
    stateDir: stateRoot,
    port: cfg.gateway?.port,
    drainMs: cfg.shutdown?.drainMs ?? 15_000,
  });
}

export async function startGateway({ root, harness = false } = {}) {
  const cfg = await loadConfig();
  if (!harness && cfg.gateway?.runLoop === true) {
    return startGatewaySupervised({ root, cfg });
  }

  // Bind safety, before anything is constructed or any socket is opened. A
  // non-loopback host with no token publishes /agent, /config, /sessions and
  // /hooks (command hooks EXECUTE shell) to every interface, and auth.check()
  // answers `{ ok: true, mode: "open" }` for protected paths when no token is
  // set outside prod — the bind guard is the only thing that stops it.
  //
  // The guard shipped wired in 3.76.1 (3ad09af) and lost its call site 34
  // minutes later to an unrelated feature merge (c9a5b10) whose tree predated
  // it. Nothing noticed for ~110 releases: both test files call
  // assertBindSafety directly, so the pure function stayed green while the
  // product stopped asking it. Keep this call adjacent to the config load.
  //
  // Resolve the bind mode to a concrete host FIRST so the guard evaluates the
  // socket host it will actually listen on. gateway.bind:"tailnet" resolves to
  // this node's tailnet IP (non-loopback) — the guard then rightly demands a
  // token, exactly as it would for lan. serve/funnel modes were already pinned
  // to loopback by coupleTailscaleExposure() at config load, so this is a no-op
  // for them. Degrades to 127.0.0.1 when the tailnet is unreachable.
  cfg.gateway.host = resolveGatewayBindHost(cfg);
  const bindSafety = assertBindSafety(cfg);
  if (!bindSafety.ok) throw new Error(`[xclaw] ${bindSafety.error}`);

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

  const webchatEnabled = isWebchatEnabled(cfg);

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
    // long-run objectives: running → interrupted at boot, then (Trust
    // Sprint) AUTO-RESUMED — a crash must cost a mission a segment, not the
    // whole night waiting for the owner's next message (live benchmark H:
    // durable state survived a kill -9 but nothing resumed it).
    import("../agent/objective-store.mjs")
      .then((m) => m.reconcileInterruptedObjectives(cfg))
      .then(async (ids) => {
        if (ids.length) {
          console.log(`[xclaw:objectives] marked ${ids.length} interrupted objective(s) resumable: ${ids.join(", ")}`);
        }
        if (!ids.length || cfg.objectives?.autoResume === false) return;
        const max = Number(cfg.objectives?.autoResumeMax) || 3;
        const store = await import("../agent/objective-store.mjs");
        const { resumeObjectiveDetached } = await import("./routes/objectives.mjs");
        let resumed = 0;
        for (const id of ids) {
          if (resumed >= max) {
            console.log(`[xclaw:objectives] auto-resume cap (${max}) reached; remaining stay interrupted`);
            break;
          }
          try {
            const o = await store.loadObjective(cfg, id);
            if (!o || o.status !== "interrupted" || o.stopRequested) continue;
            resumed += 1;
            console.log(`[xclaw:objectives] auto-resuming ${id} (${o.objective.slice(0, 80)})`);
            await resumeObjectiveDetached(cfg, o);
          } catch (e) {
            console.warn(`[xclaw:objectives] auto-resume ${id} failed:`, e?.message || e);
          }
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
  // cfg MUST reach the scheduler: re-hydrated payload jobs run with
  // job._cfg — a bare startCron() left it null, so agent cron jobs ran
  // with EMPTY config (fallback $15 cost cap paused the live governor at
  // $15.01 on 2026-08-27; wrong model/limits for every payload job).
  startCron(cfg);
  try {
    getControlPlane(cfg);
    console.log("[xclaw] control plane open");
  } catch (err) {
    console.warn("[xclaw] control plane:", err.message);
  }
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

  if (cfg.security?.digestCron !== false) {
    try {
      const digestJob = ensureApprovalDigestCronJob({
        cfg,
        enabled: true,
        everyMs: cfg.security?.digestEveryMs || cfg.security?.digestIntervalMs,
      });
      console.log(`[xclaw] approval digest cron id=${digestJob.id}`);
    } catch (err) {
      console.warn("[xclaw] approval digest cron:", err.message);
    }
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

  try {
    startComputerWatchdog(cfg, { root });
  } catch (err) {
    console.warn("[xclaw] computer watchdog:", err.message);
  }
  try {
    // Daily ops job: stale-tmp sweep (age-gated, mission-worktree-safe) plus
    // ledger compaction and JSONL rotation. Scheduled against a persisted
    // last-run stamp, NOT process uptime — an inline setInterval(24h) never
    // fired on a host that redeploys daily. Off via ops.tmpSweep.enabled and
    // ops.maintenance.enabled (both false to disarm entirely).
    const { startOpsSchedule } = await import("../ops/scheduler.mjs");
    startOpsSchedule(cfg);
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
    // API versioning: /v1/<route> is an alias for every route (clients can pin
    // a version prefix today; a breaking v2 surface can then coexist later).
    // This exact string is what auth decides on — see stripApiVersion.
    const { path: p, versioned } = stripApiVersion(url.pathname);
    if (versioned) res.setHeader("X-XClaw-Api-Version", "1");
    // Auth first, and in particular BEFORE the computer proxy: /computer/proxy/*
    // and /xclaw/computer/* forward straight to the computer plane's POST /tool,
    // which runs any tool (bash included) and authenticates nothing itself.
    // Until 3.190.0 the proxy returned above this gate, so those prefixes were
    // open on every gateway that had the (default-on) proxy enabled.
    if (req.method !== "OPTIONS") {
      const auth = gatewayAuth.check(req, p);
      if (!auth.ok) {
        // A 401 still needs CORS headers or a browser client sees an opaque
        // network error instead of the status.
        applyCors(req, res, cfg);
        return json(res, 401, { error: "unauthorized" });
      }
    }
    // Single external port: /computer/proxy/* and /xclaw/computer/* → computer plane
    if (isComputerProxyEnabled(cfg)) {
      const proxied = await proxyComputerRequest(req, res, cfg, url);
      if (proxied) return;
    }
    // CORS decided once per request (loopback-reflect by default, wildcard only
    // when cfg.gateway.corsOrigin === "*"); writeHead calls must not set ACAO.
    // Proxied responses keep the upstream's own CORS headers (applyCors is not
    // reached above), which is why this stays below the proxy.
    applyCors(req, res, cfg);

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
      // W2 finished the extraction: voice/oauth-callback/artifacts/approvals/
      // agent-run moved out too (closure collaborators passed as args).
      // Still inline BY DESIGN: /v1 passthrough, eviction SSE, native /swarm
      // (stop-proxy semantics), telegram webhook + webchat streamers (writer
      // state), and static /control /chat serving.
      if (await tryHandleProvidersRoute(routeArgs)) return;
      if (await tryHandleChannelsRoute({ ...routeArgs, channelManager })) return;
      if (await tryHandleAlertsRoute({ ...routeArgs, channelManager })) return;
      if (await tryHandleOpsRoute({ ...routeArgs, root, webchatEnabled, channelManager, XCLAW_VERSION, XCLAW_PHASE })) return;
      if (await tryHandleLedgerRoute(routeArgs)) return;
      if (await tryHandleEvalQueueRoute({ ...routeArgs, root })) return;
      if (await tryHandleJwksRoute(routeArgs)) return;
      if (await tryHandleTokensRoute(routeArgs)) return;
      if (await tryHandleSessionsRoute(routeArgs)) return;
      if (await tryHandleStopRoute(routeArgs)) return;
      if (await tryHandleSubagentsRoute(routeArgs)) return;
      if (await tryHandleMcpRoute({ ...routeArgs, mcpClient, mcpServer })) return;
      if (await tryHandleMediaRoute(routeArgs)) return;
      if (await tryHandleHooksRoute(routeArgs)) return;
      if (await tryHandleMissionsRoute(routeArgs)) return;
      if (await tryHandleObjectivesRoute(routeArgs)) return;
      if (await tryHandlePointRoute(routeArgs)) return;
      if (await tryHandleCompletionRoute(routeArgs)) return;

      if (await tryHandleVoiceRoute(routeArgs)) return;

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




      // --- swarm-ext: isolated opt-in extension module (OFF by default) ---
      // Vendored second swarm engine at src/swarm-ext/ (ADR 0003). Only
      // imported when enabled, so its deps/redis are never touched otherwise.
      // Unified swarm surface (ADR 0004): decompose engine (goal→DAG→
      // sub-agents) under /swarm/goals|tasks|decompose + legacy /api/swarm
      // aliases. MUST dispatch before the native ensemble's /swarm/ catch-all.
      if (await tryHandleSwarmGoalsRoute(routeArgs)) return;

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
          return json(res, clientErrorStatus(err) ?? 500, {
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
      if (await tryHandleAgentRunRoute({ ...routeArgs, runAgentLoop, noteEviction, streamAgentRun })) return;

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
        if (webchatEnabled && p === "/channel/webchat/suggestions/feedback" && req.method === "POST") {
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
            return json(res, clientErrorStatus(err) ?? 500, {
              ok: false,
              error: err.message || String(err),
            });
          }
        }

        if (webchatEnabled && p === "/channel/webchat/message" && req.method === "POST") {
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
            return json(res, clientErrorStatus(err) ?? 500, {
              ok: false,
              error: err.message || String(err),
            });
          }
        }

        // WebChat stream (SSE or NDJSON + Last-Event-ID resume)
        if (webchatEnabled && p === "/channel/webchat/message/stream" && req.method === "POST") {
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

        if (webchatEnabled && p === "/channel/webchat/history" && req.method === "GET") {
          const sid = url.searchParams.get("sessionId");
          if (!sid) return json(res, 400, { error: "sessionId query required" });
          const hist = getHistory(sid);
          if (!hist) return json(res, 404, { error: "session not found" });
          return json(res, 200, hist);
        }

        
      
      // P5 gateway OAuth callback (PKCE pending exchange)
      if (await tryHandleOAuthCallbackRoute(routeArgs)) return;

      if (await tryHandleArtifactsRoute({ ...routeArgs, root })) return;

      if (webchatEnabled && p === "/channel/webchat/sessions" && req.method === "GET") {
          return json(res, 200, { sessions: listChatSessions() });
        }

        if (webchatEnabled && p === "/channel/webchat/sessions" && req.method === "POST") {
          const body = await readBody(req).catch(() => ({}));
          const s = createChatSession({ workingDir: body.workingDir });
          return json(res, 200, { sessionId: s.id, createdAt: s.createdAt });
        }

        // Static UI, from the shared route table. gateway/auth.mjs asks the
        // same matcher which paths the publicUi lockdown covers, so a page can
        // never be reachable at a path the gate was not told about.
        const uiRoute = matchUiRoute(p, { webchatEnabled });
        if (uiRoute && uiRoute.app !== "artifacts") {
          const staticRoot = uiRoute.app === "control" ? controlRoot : uiRoot;
          const safe = path.normalize(uiRoute.rel).replace(/^(\.\.(\/|\\|$))+/, "");
          return serveStatic(res, path.join(staticRoot, safe));
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

      if (await tryHandleApprovalsRoute({ ...routeArgs, approvalGate })) return;

      // GET /providers/route is owned by routes/ops.mjs (dispatched above) —
      // an identical inline handler here was shadowed dead code (audit
      // 2026-08-23: duplicate route handlers, single-owner rule).


      json(res, 404, { error: "not found", path: p });
    } catch (err) {
      if (!res.headersSent) {
        // Outermost request catch: every route's uncaught throw lands here, so
        // honouring the client-error brand once here covers the whole surface.
        json(res, clientErrorStatus(err) ?? 500, { error: err.message || String(err) });
      } else if (!res.writableEnded) {
        sendSSE(res, "error", { error: err.message || String(err) });
        res.end();
      }
    }
  }, cfg);

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
    cfg,
    // Reject unauthorized upgrades whenever a token is set or requireAuth (prod)
    authorize: (req) => gatewayAuth.authorizeWebSocket(req),
  });
  // global broadcast for optional callers
  globalThis.__xclawWsBroadcast = wsBroadcast;
  console.log(`[xclaw] WebSocket: ${proto === "https" ? "wss" : "ws"}://${cfg.gateway.host}:${cfg.gateway.port}${wsHub.path}`);
  const voiceWs = attachVoiceWebSocket(server, {
    cfg,
    path: "/ws/voice",
    // Same gate as /ws/events above — this socket runs the agent, so it must
    // never be more open than the read-only event stream.
    authorize: (req) => gatewayAuth.authorizeWebSocket(req),
  });
  console.log(`[xclaw] Voice WS: ${proto === "https" ? "wss" : "ws"}://${cfg.gateway.host}:${cfg.gateway.port}${voiceWs.path}`);
  console.log(`[xclaw] Computer at http://${cfg.computer.host}:${cfg.computer.port}`);
  if (webchatEnabled) {
    console.log(`[xclaw] WebChat UI: http://${cfg.gateway.host}:${cfg.gateway.port}/chat/`);
  }
  console.log(`[xclaw] Control UI: http://${cfg.gateway.host}:${cfg.gateway.port}/control/`);
  console.log(`[xclaw] Stream: POST /agent/run/stream (SSE|NDJSON) · POST /swarm/run/stream (SSE|NDJSON) · POST /channel/webchat/message/stream (SSE|NDJSON)`);
  console.log(`[xclaw] WS:  /ws/events (subscribe admission|queue|eviction|swarm|all)`);

  // Tailscale exposure: bring up serve/funnel AFTER the socket is listening so
  // the route fronts an already-open port. Never throws — a tailscale failure
  // logs and leaves the gateway running on loopback. mode:"off" returns null.
  let tailscaleExposure = null;
  try {
    tailscaleExposure = startGatewayTailscaleExposure({
      cfg,
      port: cfg.gateway.port,
      log: (m) => console.log(`[xclaw] ${m}`),
    });
  } catch (err) {
    console.warn("[xclaw] tailscale exposure start failed:", err.message);
  }

  let shuttingDown = false;
  const shutdown = async (signal = "signal", { exit = true } = {}) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[xclaw] Shutting down (${signal})…`);
    try {
      await gracefulShutdown(cfg, { timeoutMs: cfg.shutdown?.drainMs ?? 15_000 });
    } catch (err) {
      console.warn("[xclaw] queue drain:", err.message);
    }
    // Reset the tailscale route before closing the socket (only when the
    // operator opted into resetOnExit — otherwise the route persists across
    // restarts, which is the tailscale default and usually what you want).
    if (tailscaleExposure?.stop) {
      try {
        await tailscaleExposure.stop();
      } catch (err) {
        console.warn("[xclaw] tailscale reset failed:", err.message);
      }
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
    // Close the durable cron ledger cleanly (TRUNCATE checkpoint on orderly exit).
    try { stopCron(); } catch { /* already closed */ }
    try { stopControlPlane(); } catch { /* already closed */ }
    try { stopAgentStores(); } catch { /* already closed */ }
    if (exit) process.exit(0);
  };
  // SIGHUP stays config reload only in both modes (§13.1) — never closes SQL.
  const onSighup = () => {
    void softReloadConfig(cfg)
      .then((r) => {
        console.log(`[xclaw] config reloaded (SIGHUP) changed=${r.changed.join(",") || "none"} profile=${r.profile}`);
      })
      .catch((err) => console.warn("[xclaw] config reload failed:", err.message));
  };
  process.on("SIGHUP", onSighup);
  if (harness) {
    // §13.3: the run-loop owns SIGINT/SIGTERM/SIGUSR1 and process exit; this
    // boot only hands back a stop that drains without exiting the process.
    return {
      stop: async (reason) => {
        process.removeListener("SIGHUP", onSighup);
        await shutdown(reason || "harness stop", { exit: false });
      },
    };
  }
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await new Promise(() => {});
}
