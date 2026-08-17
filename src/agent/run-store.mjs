/**
 * Feature 2 — Durable agent run snapshots for resume after gateway restart.
 *
 * Store: ~/.xclaw/agent-runs/<sessionId>.json
 * Codes: SESSION_NOT_FOUND | SESSION_CORRUPT | SESSION_UNSUPPORTED_VERSION | SESSION_WORKDIR_MISSING
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const RUN_STORE_VERSION = 1;

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
    truncated: Boolean(snapshot.truncated),
    meta: snapshot.meta || {},
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

export async function listAgentRuns(cfg, { limit = 30 } = {}) {
  const dir = runsDir(cfg);
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  names.sort().reverse();
  const out = [];
  for (const f of names.slice(0, limit)) {
    const id = f.replace(/\.json$/, "");
    const loaded = await loadAgentRun(cfg, id);
    if (loaded.ok) {
      out.push({
        sessionId: loaded.run.sessionId,
        updatedAt: loaded.run.updatedAt,
        status: loaded.run.status,
        turns: loaded.run.turns,
        model: loaded.run.model,
        messageCount: (loaded.run.messages || []).length,
      });
    } else {
      out.push({ sessionId: id, error: loaded.code });
    }
  }
  return out;
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
};
