/**
 * Feature 2 — Durable agent run snapshots for resume after gateway restart.
 *
 * Store: ~/.xclaw/agent-runs/<sessionId>.json
 * Codes: SESSION_NOT_FOUND | SESSION_CORRUPT | SESSION_UNSUPPORTED_VERSION | SESSION_WORKDIR_MISSING
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { agentExitCode } from "./complete-gate.mjs";

export const RUN_STORE_VERSION = 1;

/**
 * Which id, if any, a loop should persist a durable snapshot under.
 *
 * Feature 2 was documented against `sessionId` / `persistRun`, but every
 * default surface (CLI `xclaw agent`, TUI, POST /agent/run, `runAgent`)
 * passes the conversation id as `chatSessionId`. Treating only `sessionId`
 * as the persist key made the snapshot store a dead feature on the path
 * operators actually use.
 *
 * Returns:
 *   string — persist under this id
 *   ""     — persist, caller must generate a stable id once per run
 *   null   — do not persist (`persistRun: false` or no identity)
 */
export function resolveRunPersistId(options = {}) {
  if (options.persistRun === false) return null;
  const named =
    options.sessionId || options.runId || options.chatSessionId || null;
  if (named) return String(named);
  return options.persistRun ? "" : null;
}

export function runsDir(cfg = {}) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "agent-runs");
}

function runPath(cfg, sessionId) {
  const safe = String(sessionId || "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  if (!safe) throw new Error("sessionId required");
  return path.join(runsDir(cfg), `${safe}.json`);
}

/**
 * Atomic write of run snapshot.
 */
export async function saveAgentRun(cfg, snapshot) {
  const sessionId = snapshot.sessionId || snapshot.id;
  if (!sessionId) throw new Error("sessionId required");
  const dir = runsDir(cfg);
  await fs.mkdir(dir, { recursive: true });
  const fp = runPath(cfg, sessionId);
  const tmp = fp + ".tmp";
  const body = {
    version: RUN_STORE_VERSION,
    sessionId,
    updatedAt: new Date().toISOString(),
    workingDir: snapshot.workingDir || null,
    model: snapshot.model || null,
    streamId: snapshot.streamId || null,
    messages: Array.isArray(snapshot.messages)
      ? snapshot.messages.slice(-80)
      : [],
    toolTrace: Array.isArray(snapshot.toolTrace)
      ? snapshot.toolTrace.slice(-40)
      : [],
    turns: snapshot.turns ?? null,
    status: snapshot.status || "active",
    // S2: why the run ended, verbatim — restart recovery must be able to
    // tell resumable cutoffs (maxTurns/approval/budget) from finished work
    // without re-deriving it from message text.
    stopReason: snapshot.stopReason || null,
    truncated: Boolean(snapshot.truncated),
    meta: snapshot.meta || {},
    // v3.377: boot resume stamps these so a second restart does not
    // promote the same snapshot twice (idempotent recovery).
    resumedAt: snapshot.resumedAt || null,
    objectiveId: snapshot.objectiveId || null,
    stopRequested: Boolean(snapshot.stopRequested),
  };
  // Cap serialized size roughly
  let text = JSON.stringify(body, null, 2);
  if (text.length > 2_000_000) {
    body.messages = body.messages.slice(-20);
    body.toolTrace = body.toolTrace.slice(-10);
    body.truncated = true;
    text = JSON.stringify(body, null, 2);
  }
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, fp);
  return { ok: true, path: fp, sessionId };
}

/**
 * @returns {Promise<{ ok: true, run: object } | { ok: false, code: string, message: string }>}
 */
export async function loadAgentRun(cfg, sessionId) {
  const fp = runPath(cfg, sessionId);
  let raw;
  try {
    raw = await fs.readFile(fp, "utf8");
  } catch {
    return {
      ok: false,
      code: "SESSION_NOT_FOUND",
      message: `No durable run for session ${sessionId}`,
    };
  }
  let run;
  try {
    run = JSON.parse(raw);
  } catch {
    try {
      await fs.rename(fp, fp + ".bad");
    } catch {
      /* */
    }
    return {
      ok: false,
      code: "SESSION_CORRUPT",
      message: `Corrupt run file quarantined: ${fp}.bad`,
    };
  }
  if (run.version != null && Number(run.version) > RUN_STORE_VERSION) {
    return {
      ok: false,
      code: "SESSION_UNSUPPORTED_VERSION",
      message: `Run version ${run.version} > supported ${RUN_STORE_VERSION}`,
    };
  }
  if (run.workingDir) {
    try {
      await fs.access(run.workingDir);
    } catch {
      return {
        ok: false,
        code: "SESSION_WORKDIR_MISSING",
        message: `workingDir missing: ${run.workingDir}`,
        run,
      };
    }
  }
  return { ok: true, run, path: fp };
}

let _isResumableAgentRun;

async function resumableFlag(run) {
  // Dynamic import: run-resume.mjs already imports this module. A static
  // import here would cycle. Boot/resume already go through the classifier;
  // the operator list must not re-derive a second heuristic (live: eval
  // leftover intel-symbol-locate listed resumable after v3.473.0 skipped it).
  if (!_isResumableAgentRun) {
    ({ isResumableAgentRun: _isResumableAgentRun } = await import("./run-resume.mjs"));
  }
  return _isResumableAgentRun(run);
}

export async function listAgentRuns(cfg, { limit = 30 } = {}) {
  const dir = runsDir(cfg);
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  // Load then sort by updatedAt. Filename reverse-lex put job_* /
  // objective-* ahead of ISO-timestamp leftovers, so Control's
  // default 20-row window never showed intel-symbol-locate even
  // after the classifier was honest (live: GET /agent-runs?limit=20
  // had 0 not-ok rows; limit=400 had 4, including that leftover).
  // Then pin resumable / not-ok into the window: live leftover sat
  // at updatedAt rank 75, so newest-ok still hid it from limit=20
  // after 3.475.0. Do not pin missing-workdir / corrupt rows —
  // live 3.476.0 put 16 SESSION_WORKDIR_MISSING into the default
  // 20 after the 4 not-ok leftovers (101 of 293 at limit=400).
  const cap = Number(limit) > 0 ? Number(limit) : 30;
  const out = [];
  for (const f of names) {
    const id = f.replace(/\.json$/, "");
    const loaded = await loadAgentRun(cfg, id);
    if (loaded.ok) {
      const run = loaded.run;
      const resumable = await resumableFlag(run);
      const ok =
        run.status === "resumed" ||
        (run.status !== "active" &&
          run.status !== "interrupted" &&
          agentExitCode({ stopReason: run.stopReason }) === 0);
      out.push({
        sessionId: run.sessionId,
        updatedAt: run.updatedAt,
        status: run.status,
        stopReason: run.stopReason || null,
        turns: run.turns,
        model: run.model,
        messageCount: (run.messages || []).length,
        objectiveId: run.objectiveId || null,
        resumable,
        ok,
      });
    } else {
      out.push({ sessionId: id, error: loaded.code, updatedAt: "" });
    }
  }
  out.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const attention = [];
  const rest = [];
  for (const r of out) {
    if (r.resumable || r.ok === false) attention.push(r);
    else rest.push(r);
  }
  return [...attention, ...rest].slice(0, cap);
}

export async function deleteAgentRun(cfg, sessionId) {
  try {
    await fs.unlink(runPath(cfg, sessionId));
    return { ok: true };
  } catch {
    return { ok: false, code: "SESSION_NOT_FOUND" };
  }
}

export default {
  saveAgentRun,
  loadAgentRun,
  listAgentRuns,
  deleteAgentRun,
  runsDir,
  RUN_STORE_VERSION,
  resolveRunPersistId,
};
