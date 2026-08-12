/**
 * CLI: xclaw run — gateway stream client with NDJSON + Last-Event-ID resume.
 *
 * Examples:
 *   xclaw run "list /tmp"
 *   xclaw run --stream --ndjson "hello"
 *   xclaw run --resume <streamId> [--last-event-id <id>]
 *   xclaw run --swarm --goal "ship feature"
 *   xclaw run --webchat --session <id> "hi"
 */

import {
  streamAgent,
  streamSwarm,
  streamWebChat,
  ResumeError,
  classifyResumeError,
} from "../client/stream-resume-client.mjs";

/**
 * @param {string[]} argv  args after `run`
 * @returns {object}
 */
export function parseRunArgs(argv) {
  const out = {
    message: "",
    goal: "",
    stream: true, // default on for `run`
    ndjson: true,
    sse: false,
    resume: false,
    streamId: null,
    lastEventId: null,
    kind: "agent", // agent | swarm | webchat
    sessionId: null,
    baseUrl: null,
    gateway: null,
    quiet: false,
    verbose: false,
    maxResumeCycles: 5,
    jsonEvents: false, // print every event as NDJSON to stdout
    jsonError: false, // print structured error JSON on failure
    backoff: "full", // full | equal | decorrelated | none
    baseMs: 1000,
    maxMs: 30000,
  };

  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stream") out.stream = true;
    else if (a === "--no-stream") out.stream = false;
    else if (a === "--ndjson") {
      out.ndjson = true;
      out.sse = false;
    } else if (a === "--sse") {
      out.sse = true;
      out.ndjson = false;
    } else if (a === "--resume") {
      out.resume = true;
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        out.streamId = next;
        i++;
      }
    } else if (a === "--stream-id" || a === "--streamId") {
      out.streamId = argv[++i] || null;
      out.resume = true;
    } else if (a === "--last-event-id" || a === "--lastEventId") {
      out.lastEventId = argv[++i] || null;
    } else if (a === "--swarm") out.kind = "swarm";
    else if (a === "--webchat") out.kind = "webchat";
    else if (a === "--agent") out.kind = "agent";
    else if (a === "--goal") out.goal = argv[++i] || "";
    else if (a === "--session" || a === "--session-id") out.sessionId = argv[++i] || null;
    else if (a === "--base-url" || a === "--gateway") out.baseUrl = argv[++i] || null;
    else if (a === "--quiet" || a === "-q") out.quiet = true;
    else if (a === "--verbose" || a === "-v") out.verbose = true;
    else if (a === "--json-events") out.jsonEvents = true;
    else if (a === "--json-error") out.jsonError = true;
    else if (a === "--backoff") {
      out.backoff = String(argv[++i] || "full").toLowerCase();
    } else if (a === "--base-ms") {
      out.baseMs = Number(argv[++i]) || 1000;
    } else if (a === "--max-ms") {
      out.maxMs = Number(argv[++i]) || 30000;
    }
    else if (a === "--max-resume-cycles") {
      out.maxResumeCycles = Number(argv[++i]) || 5;
    } else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("-")) {
      throw new Error(`Unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }

  out.message = positional.join(" ").trim();
  if (!out.goal && out.kind === "swarm" && out.message) {
    out.goal = out.message;
    out.message = "";
  }
  return out;
}


/**
 * Map ResumeError codes to process exit codes.
 * @param {import('../client/stream-resume-client.mjs').ResumeError|Error|null} err
 * @returns {number}
 */
export function exitCodeForResumeError(err) {
  if (!err) return 1;
  const code = err.code || "";
  switch (code) {
    case "STREAM_NOT_FOUND":
    case "STREAM_EXPIRED":
      return 2;
    case "AUTH":
      return 3;
    case "FORBIDDEN":
      return 4;
    case "BAD_REQUEST":
      return 5;
    case "MAX_RESUME_CYCLES":
      return 6;
    case "ABORTED":
      return 130;
    case "HEARTBEAT_TIMEOUT":
    case "NETWORK":
    case "SERVER":
      return 7;
    default:
      return 1;
  }
}

/**
 * Human recovery hints for resume failures.
 * @param {import('../client/stream-resume-client.mjs').ResumeError|Error} err
 * @param {{ streamId?: string|null, lastEventId?: string|null }} [ctx]
 * @returns {string[]}
 */
export function resumeFailureHints(err, ctx = {}) {
  const code = err?.code || "";
  const streamId = err?.streamId || ctx.streamId;
  const lastEventId = err?.lastEventId || ctx.lastEventId;
  const hints = [];

  switch (code) {
    case "STREAM_NOT_FOUND":
    case "STREAM_EXPIRED":
      hints.push("Stream buffer expired or gateway restarted — start a new run (omit --resume).");
      hints.push("TTL for finished streams is ~5 minutes; live runs are kept until markEnded.");
      break;
    case "AUTH":
      hints.push("Check XCLAW_GATEWAY_TOKEN / gateway auth config.");
      break;
    case "FORBIDDEN":
      hints.push("This client is not allowed to attach to that stream.");
      break;
    case "BAD_REQUEST":
      hints.push("Check flags: --resume needs a valid streamId; new runs need a message/goal.");
      break;
    case "MAX_RESUME_CYCLES":
      hints.push("Too many reconnect attempts. Retry later or raise --max-resume-cycles.");
      if (streamId) {
        hints.push(
          `Retry: xclaw run --resume ${streamId}` +
            (lastEventId ? ` --last-event-id ${lastEventId}` : "")
        );
      }
      break;
    case "HEARTBEAT_TIMEOUT":
    case "NETWORK":
    case "SERVER":
      hints.push("Transient transport/server issue — retry with the same --resume flags.");
      if (streamId) {
        hints.push(
          `xclaw run --resume ${streamId}` +
            (lastEventId ? ` --last-event-id ${lastEventId}` : "")
        );
      }
      break;
    case "ABORTED":
      hints.push("Interrupted by user or signal.");
      break;
    default:
      if (streamId) {
        hints.push(
          `If the run may still be live: xclaw run --resume ${streamId}` +
            (lastEventId ? ` --last-event-id ${lastEventId}` : "")
        );
      }
      break;
  }
  return hints;
}

/**
 * @param {import('../client/stream-resume-client.mjs').ResumeError|Error} err
 * @param {{ streamId?: string|null, lastEventId?: string|null, kind?: string }} [ctx]
 */
export function formatResumeFailure(err, ctx = {}) {
  const classified =
    err instanceof ResumeError ? err : classifyResumeError(err, ctx);
  const hints = resumeFailureHints(classified, ctx);
  return {
    ok: false,
    error: true,
    code: classified.code || "UNKNOWN",
    message: classified.message || String(err),
    retryable: classified.retryable !== false && classified.code !== "UNKNOWN"
      ? classified.retryable
      : Boolean(classified.retryable),
    streamId: classified.streamId ?? ctx.streamId ?? null,
    lastEventId: classified.lastEventId ?? ctx.lastEventId ?? null,
    kind: ctx.kind || null,
    exitCode: exitCodeForResumeError(classified),
    hints,
  };
}


export function runHelp() {
  return `
xclaw run — stream an agent/swarm/webchat turn via the gateway

Usage:
  xclaw run [options] <message>
  xclaw run --resume <streamId> [--last-event-id <id>]

Options:
  --stream              Use gateway stream (default for run)
  --ndjson              Prefer NDJSON (default)
  --sse                 Prefer SSE instead of NDJSON
  --resume <streamId>   Resume an existing stream
  --stream-id <id>      Same as --resume
  --last-event-id <id>  Last-Event-ID for gap replay
  --swarm               Swarm stream (/swarm/run/stream)
  --webchat             WebChat stream
  --agent               Agent stream (default)
  --goal <text>         Swarm goal (or positional with --swarm)
  --session <id>        WebChat sessionId
  --base-url <url>      Gateway base (default http://127.0.0.1:18790)
  --json-events         Print every event as one NDJSON line on stdout
  --json-error          On failure, print one JSON object to stderr (machine-readable)
  --backoff <strategy>  full|equal|decorrelated|none (default: full)
  --base-ms <n>         Backoff base milliseconds (default: 1000)
  --max-ms <n>          Backoff max milliseconds (default: 30000)
  --quiet, -q           Less human logging
  --verbose, -v         Log status / resume state on stderr
  --max-resume-cycles N Outer resume attempts (default 5)

Examples:
  xclaw run "List files in /tmp"
  xclaw run --ndjson "hello"
  xclaw run --resume agent_m5k2p0_1_a3f9c2 --last-event-id agent_m5k2p0_1_a3f9c2:4
  xclaw run --swarm --goal "ship feature X"
  xclaw run --webchat --session s1 "hi"

Requires: gateway listening (xclaw gateway)

Exit codes:
  0     Success
  1     Generic failure / unknown error
  2     STREAM_NOT_FOUND or STREAM_EXPIRED (start a new run)
  3     AUTH (gateway token / credentials)
  4     FORBIDDEN (not allowed to attach)
  5     BAD_REQUEST (invalid flags or body)
  6     MAX_RESUME_CYCLES (too many reconnects)
  7     Transient transport/server (NETWORK, HEARTBEAT_TIMEOUT, SERVER)
  130   ABORTED (SIGINT / SIGTERM)

Scripting:
  docs/cli-run-exit-codes.md
  scripts/xclaw-run-lib.sh
  scripts/xclaw-run-with-retry.sh
`.trim();
}

/**
 * @param {object} cfg
 * @param {string[]} argv
 * @returns {Promise<number>} exit code
 */
export async function runStreamCli(cfg, argv) {
  let opts;
  try {
    opts = parseRunArgs(argv);
  } catch (err) {
    console.error(err.message || err);
    console.error(runHelp());
    return 1;
  }

  if (opts.help) {
    console.log(runHelp());
    return 0;
  }

  const isResumeOnly = opts.resume && opts.streamId;
  if (!isResumeOnly) {
    if (opts.kind === "swarm" && !opts.goal) {
      console.error("Usage: xclaw run --swarm --goal <text>");
      return 1;
    }
    if (opts.kind !== "swarm" && !opts.message) {
      console.error("Usage: xclaw run <message>");
      console.error(runHelp());
      return 1;
    }
  }

  // Apply xclaw.json stream.* defaults when CLI did not override
  const streamCfg = cfg?.stream || {};
  if (opts.backoff === "full" && streamCfg.backoff) opts.backoff = streamCfg.backoff;
  if (opts.baseMs === 1000 && streamCfg.baseMs != null) opts.baseMs = Number(streamCfg.baseMs) || opts.baseMs;
  if (opts.maxMs === 30000 && streamCfg.maxMs != null) opts.maxMs = Number(streamCfg.maxMs) || opts.maxMs;
  if (opts.maxResumeCycles === 5 && streamCfg.maxResumeCycles != null) {
    opts.maxResumeCycles = Number(streamCfg.maxResumeCycles);
  }

  const port = cfg?.gateway?.port || cfg?.server?.port || 18790;
  const baseUrl =
    opts.baseUrl ||
    process.env.XCLAW_GATEWAY_URL ||
    `http://127.0.0.1:${port}`;

  const format = opts.sse ? "sse" : "ndjson";
  /** @type {object} */
  const body = {};
  if (opts.kind === "swarm") body.goal = opts.goal;
  else if (opts.kind === "webchat") {
    body.message = opts.message;
    if (opts.sessionId) body.sessionId = opts.sessionId;
  } else {
    body.message = opts.message;
  }

  if (opts.streamId) {
    body.streamId = opts.streamId;
    body.resume = true;
  }
  if (opts.lastEventId) body.lastEventId = opts.lastEventId;

  const factory =
    opts.kind === "swarm"
      ? streamSwarm
      : opts.kind === "webchat"
        ? streamWebChat
        : streamAgent;

  let finalText = null;
  let exitCode = 0;
  /** @type {import('../client/stream-resume-client.mjs').ResumeError|Error|null} */
  let lastResumeErr = null;
  const log = (...a) => {
    if (!opts.quiet) console.error(...a);
  };

  const reportFailure = (err) => {
    const st = client?.getState?.() || {};
    const payload = formatResumeFailure(err, {
      streamId: st.streamId || opts.streamId,
      lastEventId: st.lastEventId || opts.lastEventId,
      kind: opts.kind,
    });
    lastResumeErr = err;
    exitCode = payload.exitCode;

    if (opts.jsonError || opts.jsonEvents) {
      console.error(JSON.stringify(payload));
    } else {
      console.error(`[xclaw] failed: ${payload.code} ${payload.message}`);
      for (const h of payload.hints) {
        console.error(`[xclaw] hint: ${h}`);
      }
    }
    return payload;
  };

  const client = factory({
    baseUrl,
    body,
    format,
    streamId: opts.streamId || undefined,
    lastEventId: opts.lastEventId || undefined,
    maxResumeCycles: opts.maxResumeCycles,
    strategy: opts.backoff,
    baseMs: opts.baseMs,
    maxMs: opts.maxMs,
    telemetryLog: opts.verbose,
    onEvent: (row) => {
      if (opts.jsonEvents) {
        console.log(JSON.stringify(row));
        return;
      }
      const ev = row.event || row.type;
      if (ev === "lifecycle") {
        if (row.phase === "start" || row.phase === "resume") {
          log(
            `[xclaw] ${row.phase} streamId=${row.streamId || client.getStreamId() || "?"} mode=${format}`
          );
        }
      } else if (ev === "tool" || row.type === "tool") {
        if (row.phase === "start" || row.name) {
          log(`  → tool ${row.name || "?"}`, row.phase || "");
        } else if (row.phase === "end") {
          log(`  ← ${(row.preview || "ok").toString().slice(0, 120)}`);
        }
      } else if (ev === "guard") {
        log(`  ! guard [${row.level || "?"}] ${row.message || ""}`);
      } else if (ev === "result") {
        finalText = row.text || row.reply?.content || row.summary || null;
        if (row.ok === false) exitCode = 1;
      } else if (ev === "error") {
        log(`  ! error ${row.code || ""} ${row.error || row.message || ""}`);
        // May also fire onResumeError for stream_not_found
        exitCode = Math.max(exitCode, 1);
      } else if (opts.verbose) {
        log(`  · ${ev}`, row.id || "");
      }
    },
    onStatus: (s, info) => {
      if (opts.verbose) log(`[xclaw] status=${s}`, info?.streamId || info?.code || "");
      if (s === "resume_failed" && opts.verbose) {
        log(`[xclaw] resume_failed code=${info?.code || "?"} ${info?.message || ""}`);
      }
    },
    onResumeError: (err) => {
      // Defer full report to catch/final so we don't double-print; track latest
      lastResumeErr = err;
      exitCode = exitCodeForResumeError(err);
      if (opts.verbose) {
        log(`[xclaw] resume error: ${err.code} ${err.message}`);
      }
    },
    onResumeState: (st) => {
      if (opts.verbose && st.status === "resume_backoff") {
        log(
          `[xclaw] resume backoff #${st.resumeCycles} streamId=${st.streamId} last=${st.lastEventId}`
        );
      }
    },
  });

  // Graceful Ctrl+C
  const onSig = () => {
    log("[xclaw] interrupting…");
    client.close();
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  try {
    if (!opts.quiet) {
      log(`[xclaw] run ${opts.kind} → ${baseUrl} (${format})`);
      if (opts.streamId) {
        log(
          `[xclaw] resume streamId=${opts.streamId}` +
            (opts.lastEventId ? ` lastEventId=${opts.lastEventId}` : "")
        );
      }
    }
    await client.start();
    // start() resolved but a fatal resume error may have been recorded
    if (lastResumeErr && client.getStatus() === "failed") {
      reportFailure(lastResumeErr);
    }
  } catch (err) {
    reportFailure(err);
  } finally {
    process.off("SIGINT", onSig);
    process.off("SIGTERM", onSig);
  }

  if (!opts.jsonEvents && finalText != null && exitCode === 0) {
    console.log("\n---\n" + finalText);
  }

  if (!opts.quiet && exitCode === 0) {
    const st = client.getState();
    log(
      `[xclaw] done status=${client.getStatus()} streamId=${st.streamId || "—"} lastEventId=${st.lastEventId || "—"}`
    );
    if (!opts.jsonEvents && client.getStreamId()) {
      log(
        `[xclaw] resume: xclaw run --resume ${client.getStreamId()}` +
          (client.getLastEventId()
            ? ` --last-event-id ${client.getLastEventId()}`
            : "")
      );
    }
  }

  return exitCode;
}


export default {
  parseRunArgs,
  runHelp,
  runStreamCli,
  exitCodeForResumeError,
  resumeFailureHints,
  formatResumeFailure,
};
