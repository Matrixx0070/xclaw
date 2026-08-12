/**
 * XClaw Gateway — Phase 3.1
 * Computer + agent API + WebChat + SSE event streaming
 */
import http from "node:http";
import { createHttpServer } from "./tls.mjs";
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
  listEvictionEvents,
  subscribeEvictionSSE,
  evictionListenerCount,
} from "./eviction-events.mjs";
import { createChannelManager } from "../channels/manager.mjs";
import { ensureHeartbeat } from "../cron/heartbeat.mjs";
import { loadAllSkills, loadMemoryFiles } from "../skills/loader.mjs";
import { estimateRequestTokens, countTextTokens, resolveTokenizer } from "../tokens/count.mjs";
import { probeTokenizerRuntime, runTokenProbes, applyProbeCalibration } from "../tokens/probes.mjs";
import { benchProbeOverhead, formatBenchReport } from "../tokens/bench.mjs";
import { readCostLedger, defaultLedgerPath, formatUsd } from "../tokens/usage-tracker.mjs";
import { analyzeCacheByTool, formatCacheByToolReport } from "../tokens/cache-by-tool.mjs";

import { spawnSubagent, listSubagents, getSubagent, configureSubagentPersistence } from "../agents/spawn.mjs";
import { createChannelPolicy } from "../channels/policy.mjs";
import { createMcpClient } from "../mcp/client.mjs";
import { createMcpServer } from "../mcp/server.mjs";
import { createPairingStore } from "../pairing/pairing-store.mjs";
import { createGatewayAuth } from "./auth.mjs";
import { startRefreshScheduler } from "../connected/refresh-scheduler.mjs";
import { takePending } from "../connected/oauth-pending.mjs";
import { setAppToken } from "../connected/token-store.mjs";
import { withOAuthRetry } from "../auth/oauth-retry.mjs";
import { oauthError, withHint, OAuthErrorCode } from "../auth/oauth-errors.mjs";
import { buildDoctorReport } from "./doctor.mjs";
import { ensureDoctorCronJob } from "../cron/doctor-job.mjs";
import { ensureEvalCronJob } from "../cron/eval-job.mjs";
import { startQueueWorker } from "../jobs/queue.mjs";
import { gracefulShutdown } from "./shutdown.mjs";
import { softReloadConfig } from "../config/reload.mjs";
import { resetSharedAlerter, getSharedAlerter } from "../alerting/alerts.mjs";
import {
  handlePagerDutyWebhook,
  verifyPagerDutySignature,
  listRecentPagerDutyWebhooks,
  readRawBody,
} from "../alerting/pagerduty-webhooks.mjs";
import { listSessions, createSession, resolveBinding, bindPeer, buildSessionKey, parseSessionKey, getSessionByKey } from "../sessions/router.mjs";
import { createApprovalGate, getSharedApprovalGate, resetSharedApprovalGate } from "../security/approvals.mjs";
import { resolveProviderRoute } from "../providers/router.mjs";
import { scheduleJob, cancelJob, listJobs, addJob, run as runCronJob, status as cronStatus, start as startCron, getJob } from "../cron/scheduler.mjs";
import { startDaemon, stopDaemon, systemdUnit, readPid, isPidAlive } from "../cli/daemon.mjs";
import { createCanvas, getCanvas, addLayer, enqueueMediaJob, listMediaJobs, listCanvases, listImageProviders, getMediaJob } from "../media/canvas.mjs";


const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Keep in sync with package.json */
const XCLAW_VERSION = "0.7.0";
const XCLAW_PHASE = 7;

function json(res, status, body) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Powered-By": "XClaw-Gateway",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
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
    startChannelHealthWatchdog(cfg, channelManager);
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
  const mcpClient = createMcpClient({ servers: cfg.mcp?.servers || [] });
  const mcpServer = createMcpServer({});
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
    const p = url.pathname;
      if (gatewayAuth.isProtectedPath(p) && req.method !== "OPTIONS") {
        const auth = gatewayAuth.check(req);
        if (!auth.ok) return json(res, 401, { error: "unauthorized" });
      }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
    }

    try {
      
      // PagerDuty inbound webhooks — HMAC on raw body
      if (p === "/webhooks/pagerduty" && req.method === "POST") {
        let rawBuf;
        try {
          rawBuf = await readRawBody(req, { limit: 1_000_000 });
        } catch (err) {
          return json(res, 413, { error: err.message || "body_too_large" });
        }
        const raw = rawBuf.toString("utf8");
        const secret =
          cfg.alerting?.pagerduty?.webhooks?.secret ||
          cfg.alerting?.pagerduty?.webhooks?.secrets ||
          process.env.PAGERDUTY_WEBHOOK_SECRET;
        const requireSig =
          cfg.alerting?.pagerduty?.webhooks?.requireSignature === true ||
          Boolean(secret);
        const sig =
          req.headers["x-pagerduty-signature"] ||
          req.headers["x-pd-signature"] ||
          "";
        const ver = verifyPagerDutySignature(rawBuf, sig, secret, {
          required: requireSig,
        });
        if (!ver.ok) {
          console.warn(`[xclaw:pd-webhook] reject: ${ver.reason}`);
          return json(res, 401, {
            error: "invalid_signature",
            reason: ver.reason,
          });
        }
        let body;
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          return json(res, 400, { error: "invalid_json" });
        }
        const out = await handlePagerDutyWebhook(body, {
          cfg,
          alerter: getSharedAlerter(cfg),
          onEvent: (e) => {
            try {
              wsBroadcast("ops", e);
            } catch {}
          },
        });
        return json(res, 200, {
          ok: true,
          eventType: out.event?.eventType,
          verified: ver.mode,
        });
      }
      if (p === "/webhooks/pagerduty/recent" && req.method === "GET") {
        return json(res, 200, {
          events: listRecentPagerDutyWebhooks(
            Number(url.searchParams.get("limit") || 20)
          ),
        });
      }

      if ((p === "/report" || p === "/status/report") && req.method === "GET") {
        const { buildStatusReport } = await import("./report.mjs");
        const rep = await buildStatusReport(cfg);
        if (url.searchParams.get("format") === "json") return json(res, 200, rep);
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
        res.end(rep.markdown);
        return;
      }
      if (p === "/config/reload" && req.method === "POST") {
        const { softReloadConfig } = await import("../config/reload.mjs");
        try {
          const r = await softReloadConfig(cfg);
          return json(res, 200, r);
        } catch (err) {
          return json(res, 500, { ok: false, error: err.message });
        }
      }
      if (p === "/dashboard" && req.method === "GET") {
        const { buildDashboard } = await import("./dashboard.mjs");
        return json(res, 200, await buildDashboard(cfg));
      }
      if (p === "/profile" && req.method === "GET") {
        const { listProfiles } = await import("../config/profiles.mjs");
        return json(res, 200, {
          active: cfg.profile || "dev",
          autoApprove: cfg.security?.autoApprove,
          maxTurns: cfg.agent?.maxTurns,
          evalCron: cfg.eval?.cron,
          profiles: listProfiles(),
        });
      }

      if (p === "/eval/scoreboard" && req.method === "GET") {
        const { buildScoreboard } = await import("../eval/scoreboard.mjs");
        return json(res, 200, await buildScoreboard(cfg, { root }));
      }
      if (p === "/eval/spend" && req.method === "GET") {
        const { summarizeEvalSpend } = await import("../eval/spend.mjs");
        return json(res, 200, await summarizeEvalSpend(cfg, {
          limit: Number(url.searchParams.get("limit") || 100),
        }));
      }
      if (p === "/eval/history" && req.method === "GET") {
        const { listEvalHistory } = await import("../eval/history.mjs");
        const items = await listEvalHistory(cfg, { limit: Number(url.searchParams.get("limit") || 30) });
        return json(res, 200, { history: items, count: items.length });
      }
      if (p === "/eval/baseline" && req.method === "GET") {
        try {
          const fs = await import("node:fs/promises");
          const path = await import("node:path");
          const fp = path.join(root, "eval", "baselines", "main.json");
          const raw = await fs.readFile(fp, "utf8");
          return json(res, 200, JSON.parse(raw));
        } catch (err) {
          return json(res, 404, { error: "baseline not found", detail: err.message });
        }
      }

      if (p === "/queue/stats" && req.method === "GET") {
        const { queueStats } = await import("../jobs/queue.mjs");
        return json(res, 200, await queueStats(cfg));
      }
      if (p === "/queue/admission" && req.method === "GET") {
        const { getDefaultAdmission, qedStaffing, offeredLoadErl } = await import("../utils/admission.mjs");
        const adm = getDefaultAdmission(cfg);
        const q = cfg.queue || {};
        const a = Number(url.searchParams.get("a"));
        const beta = Number(url.searchParams.get("beta") || 1);
        const arrivals = Number(url.searchParams.get("arrivalsPerSec"));
        const meanS = Number(url.searchParams.get("meanServiceSec"));
        let suggest = null;
        if (Number.isFinite(arrivals) && Number.isFinite(meanS)) {
          suggest = adm.suggestConcurrency({ arrivalsPerSec: arrivals, meanServiceSec: meanS, beta });
        } else if (Number.isFinite(a)) {
          suggest = { a, beta, suggested: qedStaffing(a, beta), current: adm.concurrency };
        }
        return json(res, 200, {
          ok: true,
          policy: {
            concurrency: q.concurrency ?? adm.concurrency,
            maxDepth: q.maxDepth ?? adm.maxDepth,
            maxWaitMs: q.maxWaitMs ?? adm.maxWaitMs,
            maxConcurrencyCap: q.maxConcurrencyCap ?? 16,
          },
          metrics: adm.snapshot().metrics,
          suggest,
        });
      }
      if (p === "/queue/dead" && req.method === "GET") {
        const { listDeadLetter } = await import("../jobs/queue.mjs");
        const items = await listDeadLetter(cfg, { limit: Number(url.searchParams.get("limit") || 50) });
        return json(res, 200, { deadLetter: items, count: items.length });
      }
      if (p === "/queue" && req.method === "GET") {
        const { listQueue, queueStatus } = await import("../jobs/queue.mjs");
        const items = await listQueue(cfg, { limit: Number(url.searchParams.get("limit") || 50) });
        const { queueStats } = await import("../jobs/queue.mjs");
        const stats = await queueStats(cfg);
        return json(res, 200, { queue: items, count: items.length, worker: queueStatus(cfg), stats });
      }
      if (p === "/queue/retry-failed" && req.method === "POST") {
        const { retryFailedQueue } = await import("../jobs/queue.mjs");
        return json(res, 200, await retryFailedQueue(cfg));
      }
      if (p === "/queue/clear" && req.method === "POST") {
        const { clearCompletedQueue } = await import("../jobs/queue.mjs");
        return json(res, 200, await clearCompletedQueue(cfg));
      }
      if (p.startsWith("/queue/") && p.endsWith("/cancel") && req.method === "POST") {
        const { cancelQueueItem } = await import("../jobs/queue.mjs");
        const id = p.slice("/queue/".length, -"/cancel".length);
        const item = await cancelQueueItem(cfg, id);
        if (!item) return json(res, 404, { error: "not found" });
        return json(res, 200, item);
      }
      if (p === "/queue/pause" && req.method === "POST") {
        const { pauseQueue } = await import("../jobs/queue.mjs");
        return json(res, 200, pauseQueue());
      }
      if (p === "/queue/resume" && req.method === "POST") {
        const { resumeQueue } = await import("../jobs/queue.mjs");
        return json(res, 200, resumeQueue(cfg));
      }
      if (p === "/queue" && req.method === "POST") {
        const body = await readBody(req).catch(() => ({}));
        const { enqueueJob, startQueueWorker } = await import("../jobs/queue.mjs");
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
        const item = await enqueueJob(cfg, {
          goal: body.goal || body.message,
          verify: body.verify || [],
          maxTurns: body.maxTurns,
          priority: body.priority,
        });
        return json(res, 202, item);
      }
      if (p.startsWith("/queue/") && req.method === "GET") {
        const { getQueueItem } = await import("../jobs/queue.mjs");
        const id = p.slice("/queue/".length).split("/")[0];
        const item = await getQueueItem(cfg, id);
        if (!item) return json(res, 404, { error: "not found" });
        return json(res, 200, item);
      }
      if (p === "/cron/eval" && req.method === "GET") {
        const { evalCronStatus } = await import("../cron/eval-job.mjs");
        return json(res, 200, evalCronStatus());
      }
      if (p === "/cron/eval/run" && req.method === "POST") {
        const { runScheduledEval } = await import("../cron/eval-job.mjs");
        const body = await readBody(req).catch(() => ({}));
        // async fire for long suite — but await for correctness in v1
        const out = await runScheduledEval({ cfg, tag: body.tag, writeBaseline: body.writeBaseline !== false });
        return json(res, out.ok ? 200 : 422, out);
      }

      if (p === "/jobs" && req.method === "GET") {
        const { listJobs } = await import("../jobs/history.mjs");
        const limit = Number(url.searchParams.get("limit") || 30);
        const items = await listJobs(cfg, { limit });
        return json(res, 200, { jobs: items, count: items.length });
      }
      if (p.startsWith("/jobs/") && req.method === "GET") {
        const { getJob } = await import("../jobs/history.mjs");
        const id = p.slice("/jobs/".length).split("/")[0];
        const job = await getJob(cfg, id);
        if (!job) return json(res, 404, { error: "job not found" });
        return json(res, 200, job);
      }
      if (p === "/skills/proposals" && req.method === "GET") {
        const { listProposals } = await import("../skills/propose.mjs");
        const items = await listProposals(cfg, Number(url.searchParams.get("limit") || 20));
        return json(res, 200, { proposals: items, count: items.length });
      }
      if (p === "/skills/stats" && req.method === "GET") {
        const { loadSkillStats } = await import("../skills/registry.mjs");
        return json(res, 200, await loadSkillStats(cfg));
      }

      if (p === "/jobs" && req.method === "POST") {
        const body = await readBody(req).catch(() => ({}));
        const goal = body.goal || body.message || body.prompt;
        if (!goal) return json(res, 400, { error: "goal required" });
        const { runJob, saveJobSummary } = await import("../jobs/job.mjs");
        const job = await runJob({
          goal,
          cfg,
          workspace: body.workspace,
          verify: body.verify || [],
          maxTurns: body.maxTurns || cfg.agent?.maxTurns || 12,
          timeoutMs: body.timeoutMs || 180000,
          autoApprove: body.autoApprove,
        });
        await saveJobSummary(job).catch(() => {});
        return json(res, job.pass ? 200 : 422, {
          id: job.id,
          status: job.status,
          pass: job.pass,
          turns: job.turns,
          toolCalls: job.toolCalls,
          wallMs: job.wallMs,
          text: job.text,
          verify: job.verify,
          evidence: job.evidence,
          error: job.error,
        });
      }

      if (p === "/routes") {
        const { listRoutes } = await import("./routes-map.mjs");
        const routes = listRoutes();
        return json(res, 200, { count: routes.length, routes });
      }
      if (p === "/version") {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const { uptimeInfo } = await import("./uptime.mjs");
        let version = "0.0.0";
        try {
          version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
        } catch {}
        return json(res, 200, {
          name: "xclaw",
          version,
          profile: cfg.profile || "dev",
          ...uptimeInfo(),
        });
      }
      if (p === "/metrics") {
        const { renderMetrics } = await import("./metrics.mjs");
        const text = await renderMetrics(cfg);
        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
        res.end(text);
        return;
      }
      if (p === "/ready" || p === "/readiness") {
        const { checkReadiness } = await import("./readiness.mjs");
        const r = await checkReadiness(cfg);
        return json(res, r.status, r.body);
      }
      if (p === "/health" || p === "/gateway/health") {
        const computerOk = await isComputerRunning(cfg);
        return json(res, 200, {
          status: "healthy",
          service: "XClaw-Gateway",
          version: XCLAW_VERSION,
          phase: XCLAW_PHASE,
          computer: computerOk ? "up" : "down",
          computerUrl: `http://${cfg.computer.host}:${cfg.computer.port}`,
          webchat: webchatEnabled,
          sse: true,
        });
      }

      // ---- JWKS public + invalidation API ----
      if (
        (p === "/xclaw/jwks.json" ||
          p === "/.well-known/jwks.json" ||
          p === "/jwks.json") &&
        req.method === "GET"
      ) {
        const { getJwksCached, exportJwks } = await import("../auth/jwks.mjs");
        const force = url.searchParams.get("force") === "1";
        const out = force
          ? await exportJwks(cfg)
          : await getJwksCached(cfg, { force: false });
        const etag = out.etag || out.exportedAt;
        const inm = req.headers["if-none-match"];
        if (inm && etag && inm.replace(/"/g, "") === String(etag)) {
          res.writeHead(304, {
            ETag: `"${etag}"`,
            "Cache-Control": "public, max-age=60",
            "X-Powered-By": "XClaw-Gateway",
          });
          res.end();
          return;
        }
        const body = JSON.stringify(out.jwks || out, null, 2);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          ETag: `"${etag}"`,
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          "X-XClaw-Key-Generation": String(out.generation ?? ""),
          "X-XClaw-Key-Kid": String(out.kid ?? ""),
          "X-Powered-By": "XClaw-Gateway",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(body);
        return;
      }

      if (p === "/xclaw/jwks/epoch" && req.method === "GET") {
        const { getInvalidationEpoch } = await import("../auth/jwks-invalidation.mjs");
        return json(res, 200, await getInvalidationEpoch(cfg));
      }

      if (p === "/xclaw/jwks/invalidate" && req.method === "POST") {
        const { handleInvalidationHttp } = await import("../auth/jwks-invalidation.mjs");
        const body = await readBody(req).catch(() => ({}));
        const r = await handleInvalidationHttp(cfg, "POST", body);
        // After publish, warm local cache
        try {
          const { refreshJwksAfterRotation } = await import("../auth/jwks.mjs");
          await refreshJwksAfterRotation(cfg, body || {});
        } catch {
          /* optional */
        }
        return json(res, r.status, r.body);
      }

      if (p === "/xclaw/jwks/cache" && req.method === "GET") {
        const { getJwksCached } = await import("../auth/jwks.mjs");
        const { getInvalidationEpoch } = await import("../auth/jwks-invalidation.mjs");
        const cached = await getJwksCached(cfg);
        const epoch = await getInvalidationEpoch(cfg);
        return json(res, 200, {
          etag: cached.etag,
          generation: cached.generation,
          kid: cached.kid,
          keyCount: cached.keyCount ?? cached.jwks?.keys?.length,
          dualWindowOpen: cached.dualWindowOpen,
          invalidationEpoch: epoch.epoch,
          exportedAt: cached.exportedAt,
        });
      }

      if (p === "/alerts/status" && req.method === "GET") {
        return json(res, 200, getSharedAlerter(cfg).status());
      }
      if (p === "/alerts/history" && req.method === "GET") {
        const limit = Number(url.searchParams.get("limit") || 20);
        return json(res, 200, { history: getSharedAlerter(cfg).history(limit) });
      }
      if (p === "/alerts/pd/levels" && req.method === "GET") {
        const { previewEscalationLevels, diffEscalationLevels } = await import("../alerting/escalation-levels.mjs");
        const mode = url.searchParams.get("mode") || "preview";
        if (mode === "diff") return json(res, 200, await diffEscalationLevels(cfg));
        return json(res, 200, previewEscalationLevels(cfg));
      }
      if (p === "/alerts/pd/levels" && req.method === "POST") {
        const { applyEscalationLevels } = await import("../alerting/escalation-levels.mjs");
        const body = await readBody(req).catch(() => ({}));
        const out = await applyEscalationLevels(cfg, body);
        return json(res, out.ok ? 200 : 502, out);
      }
      if (p === "/alerts/pd/setup" && req.method === "GET") {
        const { pagerDutySetupReport } = await import("../alerting/pagerduty-rest.mjs");
        return json(res, 200, await pagerDutySetupReport(cfg));
      }
      if (p === "/alerts/pd/policies" && req.method === "GET") {
        const { listEscalationPolicies } = await import("../alerting/pagerduty-rest.mjs");
        const out = await listEscalationPolicies({ query: url.searchParams.get("query") }, cfg);
        return json(res, out.ok ? 200 : 502, out);
      }
      if (p === "/alerts/pd/services" && req.method === "GET") {
        const { listServices } = await import("../alerting/pagerduty-rest.mjs");
        const out = await listServices({}, cfg);
        return json(res, out.ok ? 200 : 502, out);
      }
      if (p === "/alerts/pd" && req.method === "POST") {
        const { sendPagerDutyEvent, pagerDutyDedupKey } = await import("../alerting/pagerduty.mjs");
        const body = await readBody(req);
        const out = await sendPagerDutyEvent({
          routingKey:
            body.routingKey ||
            cfg.alerting?.pagerduty?.routingKey ||
            process.env.PAGERDUTY_ROUTING_KEY,
          eventAction: body.eventAction || body.action || "trigger",
          dedupKey: pagerDutyDedupKey(body.dedupKey || body.key || `xclaw:${Date.now()}`),
          summary: body.summary || body.title || "XClaw alert",
          severity: body.severity || "error",
          customDetails: body.customDetails || body.meta || {},
        });
        return json(res, out.ok ? 200 : 502, out);
      }
      if (p === "/alerts/test" && req.method === "POST") {
        const body = await readBody(req).catch(() => ({}));
        const out = await getSharedAlerter(cfg).send({
          title: body.title || "Test alert",
          body: body.body || "Manual test from XClaw",
          severity: body.severity || "error",
          key: body.key || `test:${Date.now()}`,
        });
        return json(res, 200, out);
      }
      if (p === "/doctor/run" && req.method === "POST") {
        const { runDoctorCheck } = await import("../cron/doctor-job.mjs");
        const body = await readBody(req).catch(() => ({}));
        const out = await runDoctorCheck({
          cfg,
          channelManager,
          isComputerRunning,
          notifyOnFail: body.notifyOnFail !== false,
          notifyOnOk: body.notifyOnOk === true,
          delivery: body.delivery || cfg.doctor?.cron?.delivery || null,
        });
        return json(res, out.report.ok ? 200 : 503, out);
      }
      if (p === "/doctor" || p === "/gateway/doctor") {
        const report = await buildDoctorReport({
          cfg,
          channelManager,
          isComputerRunning,
        });
        return json(res, report.ok ? 200 : 503, report);
      }

      if (p === "/gateway/info" || p === "/info") {
        return json(res, 200, {
          name: "XClaw Gateway",
          version: XCLAW_VERSION,
          phase: XCLAW_PHASE,
          gateway: cfg.gateway,
          computer: {
            host: cfg.computer.host,
            port: cfg.computer.port,
            healthy: await isComputerRunning(cfg),
          },
          agent: {
            model: cfg.agent?.model,
            maxTurns: cfg.agent?.maxTurns,
            hasApiKey: Boolean(
              cfg.agent?.apiKey ||
                process.env.OPENAI_API_KEY ||
                process.env.XCLAW_API_KEY
            ),
          },
          channels: {
            webchat: { enabled: webchatEnabled, path: "/chat/", sse: true },
            messaging: channelManager.status(),
          },
          paths: cfg.paths,
        });
      }

      if (p === "/computer/health") {
        try {
          const u = `http://${cfg.computer.host}:${cfg.computer.port}/health`;
          const r = await fetch(u);
          const body = await r.json();
          return json(res, r.status, body);
        } catch (e) {
          return json(res, 502, { error: "computer unreachable", detail: e.message });
        }
      }






      if (p === "/tokens/cache-by-tool" && req.method === "POST") {
        const body = await readBody(req);
        const analysis = analyzeCacheByTool({
          usageTurns: body.usageTurns || body.usage?.turns || [],
          toolTrace: body.toolTrace || [],
          events: body.events || [],
        });
        return json(res, 200, {
          ok: true,
          summary: formatCacheByToolReport(analysis),
          analysis,
        });
      }

      if (p === "/events/eviction" && req.method === "GET") {
        const limit = Number(url.searchParams.get("limit") || 50);
        return json(res, 200, {
          events: listEvictionEvents({ limit }),
          listeners: evictionListenerCount(),
        });
      }

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
          "Access-Control-Allow-Origin": "*",
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

      if (p === "/tokens/cost" && req.method === "GET") {
        const ledger = cfg.tokens?.ledgerPath || defaultLedgerPath();
        const since = url.searchParams.get("since");
        const agg = await readCostLedger(ledger, { since });
        return json(res, 200, { ok: true, ...agg });
      }

      if (p === "/tokens/bench" && (req.method === "GET" || req.method === "POST")) {
        const body = req.method === "POST" ? await readBody(req).catch(() => ({})) : {};
        const model = body.model || url.searchParams.get("model") || cfg.agent?.model || "gpt-4o-mini";
        const iterations = Number(body.iterations || url.searchParams.get("iterations") || 100);
        const bench = await benchProbeOverhead({
          cfg,
          model,
          iterations: Number.isFinite(iterations) ? iterations : 100,
          latencySamples: Number(body.latencySamples || 40),
          probeIterations: Number(body.probeIterations || 5),
          agentTurnsPerDay: Number(body.agentTurnsPerDay || 500),
        });
        return json(res, 200, {
          ok: true,
          summary: formatBenchReport(bench),
          bench,
        });
      }

      if (p === "/tokens/probe" && (req.method === "GET" || req.method === "POST")) {
        const body = req.method === "POST" ? await readBody(req).catch(() => ({})) : {};
        const model = body.model || url.searchParams.get("model") || cfg.agent?.model || "gpt-4o-mini";
        const calibrate = body.calibrate === true || url.searchParams.get("calibrate") === "1";
        const result = await probeTokenizerRuntime(cfg, model, {
          baseUrl: cfg.agent?.baseUrl,
        });
        let calibrated = null;
        if (calibrate && result.probe?.calibration?.suggested) {
          const { cfg: newTok, applied } = applyProbeCalibration(cfg.tokens, result.probe);
          if (applied) {
            calibrated = newTok;
            // runtime only — does not persist to disk
            cfg.tokens = { ...cfg.tokens, ...newTok };
          }
        }
        return json(res, 200, {
          ok: result.probe.ok,
          ...result,
          calibrated,
        });
      }

      if (p === "/tokens/estimate" && req.method === "POST") {
        const body = await readBody(req);
        const model = body.model || cfg.agent?.model || "gpt-4o-mini";
        const tok = await resolveTokenizer(cfg, model);
        const cfgTok = {
          tokens: {
            ...(cfg.tokens || {}),
            mode: tok.encodeFn ? "tiktoken" : "heuristic",
            _encodeFn: tok.encodeFn,
          },
        };
        const messages = body.messages || [
          { role: "user", content: body.text || body.message || "" },
        ];
        const est = estimateRequestTokens({
          messages,
          tools: body.tools,
          model,
          cfg: cfgTok,
        });
        return json(res, 200, { ok: true, tokenizer: tok.mode, package: tok.package || null, ...est });
      }

      // --- Skills / memory ---
      if (p === "/skills" && req.method === "GET") {
        const skills = await loadAllSkills({
          configDir: cfg.paths?.configDir,
          cwd: process.cwd(),
        });
        return json(res, 200, {
          skills: skills.map((s) => ({
            name: s.name,
            description: s.description,
            path: s.path,
          })),
        });
      }

      if (p === "/memory" && req.method === "GET") {
        const cwd = new URL(req.url, "http://x").searchParams.get("cwd") || process.cwd();
        const files = await loadMemoryFiles(cwd);
        return json(res, 200, {
          files: files.map((f) => ({
            name: f.name,
            path: f.path,
            chars: f.body.length,
            preview: f.body.slice(0, 200),
          })),
        });
      }

      // --- Channels status (always) ---
      if (p === "/channels/status" && req.method === "GET") {
        return json(res, 200, {
          webchat: { enabled: webchatEnabled },
          messaging: channelManager.status(),
        });
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

      if (p === "/swarm/merges" && req.method === "GET") {
        const { listMergeProposals } = await import("../agents/swarm-merge.mjs");
        const statusFilter = url.searchParams.get("status") || undefined;
        const limit = Number(url.searchParams.get("limit") || 30);
        const items = await listMergeProposals(cfg, { status: statusFilter, limit });
        return json(res, 200, { count: items.length, proposals: items });
      }

      if (p.startsWith("/swarm/merges/") && p.endsWith("/approve") && req.method === "POST") {
        const { approveMergeProposal } = await import("../agents/swarm-merge.mjs");
        const id = p.slice("/swarm/merges/".length, p.length - "/approve".length);
        const body = await readBody(req).catch(() => ({}));
        const result = await approveMergeProposal(cfg, id, {
          repoDir: body.repo || body.repoDir,
          checkOnly: body.checkOnly === true,
        });
        return json(res, result.ok ? 200 : 422, result);
      }

      if (p.startsWith("/swarm/merges/") && p.endsWith("/reject") && req.method === "POST") {
        const { rejectMergeProposal } = await import("../agents/swarm-merge.mjs");
        const id = p.slice("/swarm/merges/".length, p.length - "/reject".length);
        const body = await readBody(req).catch(() => ({}));
        const result = await rejectMergeProposal(cfg, id, body.reason || "");
        return json(res, result.ok ? 200 : 422, result);
      }

      if (p.startsWith("/swarm/merges/") && req.method === "GET") {
        const { getMergeProposal } = await import("../agents/swarm-merge.mjs");
        const id = p.slice("/swarm/merges/".length).split("/")[0];
        const rec = await getMergeProposal(cfg, id);
        if (!rec) return json(res, 404, { error: "merge proposal not found", id });
        return json(res, 200, rec);
      }

      if (p.startsWith("/swarm/") && req.method === "GET") {
        const { getSwarmRun } = await import("../agents/swarm-store.mjs");
        const id = p.slice("/swarm/".length).split("/")[0];
        if (!id || id === "run" || id === "merges") {
          return json(res, 404, { error: "not found" });
        }
        const run = await getSwarmRun(cfg, id);
        if (!run) return json(res, 404, { error: "swarm run not found", id });
        return json(res, 200, run);
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


      // --- Parity APIs (gaps 1–10) ---
      if (p === "/subagents" && req.method === "GET") {
        return json(res, 200, { subagents: listSubagents() });
      }
      if (p === "/subagents/spawn" && req.method === "POST") {
        const body = await readBody(req);
        if (!body.task) return json(res, 400, { error: "task required" });
        const out = await spawnSubagent({
          task: body.task,
          maxTurns: body.maxTurns,
          cfg,
          parentId: body.parentId,
          workingDir: body.workingDir,
        });
        return json(res, out.ok ? 200 : 500, out);
      }
      if (p.startsWith("/subagents/") && req.method === "GET") {
        const id = p.slice("/subagents/".length);
        const s = getSubagent(id);
        return s ? json(res, 200, s) : json(res, 404, { error: "not found" });
      }

      if (p === "/sessions" && req.method === "GET") {
        return json(res, 200, { sessions: listSessions() });
      }
      if (p === "/sessions" && req.method === "POST") {
        const body = await readBody(req).catch(() => ({}));
        return json(res, 200, createSession(body));
      }
      if (p === "/sessions/bind" && req.method === "POST") {
        const body = await readBody(req);
        const s = bindPeer(body.channel, body.peerId, body.sessionId);
        return json(res, 200, { ok: true, session: s });
      }
      if (p === "/sessions/resolve" && req.method === "POST") {
        const body = await readBody(req);
        return json(res, 200, resolveBinding(body.channel, body.peerId, body.peerKind));
      }
      if (p === "/sessions/keys" && req.method === "POST") {
        const body = await readBody(req);
        if (body.sessionKey) return json(res, 200, { parsed: parseSessionKey(body.sessionKey) });
        return json(res, 200, { sessionKey: buildSessionKey(body) });
      }
      if (p === "/sessions/by-key" && req.method === "GET") {
        const key = url.searchParams.get("key");
        const s = getSessionByKey(key);
        return s ? json(res, 200, s) : json(res, 404, { error: "not found" });
      }

      if (p === "/security/pending" && req.method === "GET") {
        return json(res, 200, { pending: approvalGate.listPending() });
      }
      if (p === "/security/decide" && req.method === "POST") {
        const body = await readBody(req);
        return json(res, 200, approvalGate.decide(body.id, Boolean(body.approved), body.note));
      }
      if (p === "/checkpoints" && req.method === "GET") {
        const { listCheckpoints, loadCheckpoint } = await import("../jobs/checkpoint.mjs");
        const id = url.searchParams.get("id");
        if (id) {
          try {
            return json(res, 200, await loadCheckpoint(cfg, id));
          } catch (e) {
            return json(res, 404, { error: e.message });
          }
        }
        return json(res, 200, { checkpoints: await listCheckpoints(cfg, { limit: Number(url.searchParams.get("limit") || 30) }) });
      }
      if (p === "/checkpoints/resume" && req.method === "POST") {
        const body = await readBody(req).catch(() => ({}));
        const { resumeJobFromCheckpoint } = await import("../jobs/checkpoint.mjs");
        try {
          const job = await resumeJobFromCheckpoint(cfg, body.id, { autoApprove: body.autoApprove });
          return json(res, 200, { id: job.id, pass: job.pass, status: job.status, turns: job.turns, resumedFrom: job.resumedFrom });
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
      }
      if (p === "/subagents/merge" && req.method === "POST") {
        const body = await readBody(req).catch(() => ({}));
        const { getSubagent } = await import("../agents/spawn.mjs");
        const { mergeSubagentWorktree } = await import("../agents/worktree.mjs");
        const rec = getSubagent(body.subagentId);
        if (!rec) return json(res, 404, { error: "subagent not found" });
        const repo = body.repo || process.cwd();
        const out = await mergeSubagentWorktree(
          { result: rec.result, worktree: rec },
          repo,
          { checkOnly: Boolean(body.checkOnly) }
        );
        return json(res, out.ok ? 200 : 409, out);
      }
      if (p === "/security/policy" && req.method === "GET") {
        return json(res, 200, {
          telegram: cfg.channels?.telegram || {},
          discord: cfg.channels?.discord || {},
          security: cfg.security || {},
        });
      }

      if (p === "/mcp" && req.method === "POST") {
        const body = await readBody(req);
        const out = await mcpServer.handleRequest(body);
        return json(res, 200, out);
      }
      if (p === "/mcp/tools" && req.method === "GET") {
        const tools = await mcpClient.listTools();
        return json(res, 200, { tools });
      }
      if (p === "/mcp/call" && req.method === "POST") {
        const body = await readBody(req);
        const out = await mcpClient.callTool(body.name, body.arguments || body.args || {});
        return json(res, 200, out);
      }

      if (p === "/providers/route" && req.method === "GET") {
        const model = url.searchParams.get("model") || undefined;
        return json(res, 200, resolveProviderRoute(cfg, { model }));
      }

      if (p === "/cron/logs" && req.method === "GET") {
        const { monitorCronLogs } = await import("../cron/logs.mjs");
        const lines = Number(url.searchParams.get("lines") || 40);
        return json(res, 200, monitorCronLogs(cfg, { lines }));
      }
      if (p === "/cron/logs/doctor" && req.method === "GET") {
        const { tailFile, doctorLogPath, parseDoctorLogRuns } = await import("../cron/logs.mjs");
        const lines = Number(url.searchParams.get("lines") || 80);
        const tail = tailFile(doctorLogPath(cfg), { lines });
        return json(res, 200, {
          ...tail,
          runs: parseDoctorLogRuns(tail.text),
        });
      }
      if (p === "/cron/status" && req.method === "GET") {
        return json(res, 200, cronStatus());
      }
      if (p === "/cron/jobs" && req.method === "GET") {
        return json(res, 200, { jobs: listJobs() });
      }
      if (p === "/cron/jobs" && req.method === "POST") {
        const body = await readBody(req);
        const job = addJob({
          name: body.name || "job",
          intervalMs: body.intervalMs,
          schedule: body.schedule,
          enabled: body.enabled !== false,
          sessionKey: body.sessionKey,
          sessionTarget: body.sessionTarget,
          delivery: body.delivery,
          deliveryContext: body.deliveryContext,
          payload: body.payload,
          agentId: body.agentId,
          cfg,
          handler: body.payload?.message || body.payload?.text
            ? undefined // use announceCronJob default
            : async (job) => {
                console.log(`[xclaw:cron] tick ${job.name}`, job.delivery || "");
              },
        });
        return json(res, 200, { id: job.id, job: { ...job, handler: undefined } });
      }
      if (p.startsWith("/cron/jobs/") && p.endsWith("/run") && req.method === "POST") {
        const id = p.slice("/cron/jobs/".length, -"/run".length);
        return json(res, 200, await runCronJob(id));
      }
      if (p.startsWith("/cron/jobs/") && req.method === "GET") {
        const id = p.slice("/cron/jobs/".length);
        const job = getJob(id);
        return job
          ? json(res, 200, { ...job, handler: undefined })
          : json(res, 404, { error: "not found" });
      }
      if (p.startsWith("/cron/jobs/") && req.method === "DELETE") {
        cancelJob(p.slice("/cron/jobs/".length));
        return json(res, 200, { ok: true });
      }

      if (p === "/media/canvas" && req.method === "POST") {
        const body = await readBody(req).catch(() => ({}));
        return json(res, 200, createCanvas(body));
      }
      if (p.startsWith("/media/canvas/") && req.method === "GET") {
        const c = getCanvas(p.slice("/media/canvas/".length));
        return c ? json(res, 200, c) : json(res, 404, { error: "not found" });
      }
      if (p === "/media/providers" && req.method === "GET") {
        return json(res, 200, { providers: listImageProviders() });
      }
      if (p === "/media/canvas" && req.method === "GET") {
        return json(res, 200, { canvases: listCanvases() });
      }
      if (p === "/media/jobs" && req.method === "GET") {
        return json(res, 200, { jobs: listMediaJobs() });
      }
      if (p.startsWith("/media/jobs/") && req.method === "GET") {
        const job = getMediaJob(p.slice("/media/jobs/".length));
        return job ? json(res, 200, job) : json(res, 404, { error: "not found" });
      }
      if (p === "/media/jobs" && req.method === "POST") {
        const body = await readBody(req);
        return json(res, 200, enqueueMediaJob(body));
      }

      if (p === "/gateway") {
        return json(res, 200, {
          message: "XClaw Gateway Phase 7",
          endpoints: [
            "GET  /health",
            "GET  /gateway/info",
            "POST /agent/run",
            "POST /agent/run/stream          (SSE or NDJSON via Accept)",
            "POST /swarm/run",
            "POST /swarm/run/stream       (SSE or NDJSON via Accept)",
            "GET  /swarm",
            "GET  /swarm/:id",
            "GET  /swarm/merges",
            "POST /swarm/merges/:id/approve",
            "POST /swarm/merges/:id/reject",
            "GET  /xclaw/jwks.json",
            "GET  /control/",
            "GET  /chat/",
            "POST /channel/webchat/message",
            "POST /channel/webchat/message/stream  (SSE or NDJSON via Accept)",
            "GET  /channel/webchat/history?sessionId=",
            "GET  /channel/webchat/sessions",
            "GET  /channels/status",
            "GET  /events/eviction",
            "GET  /events/eviction/stream  (SSE)",
            "WS   /ws/events                 (WebSocket JSON)",
            "GET  /tokens/cost",
            "GET  /tokens/bench",
            "GET  /tokens/probe",
            "POST /tokens/probe",
            "GET  /skills",
            "GET  /memory?cwd=",
          ],
        });
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
