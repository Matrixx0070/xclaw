/**
 * Disk persistence for sessions/bindings (OpenClaw-inspired durable route map).
 *
 * sessions.json belongs to the config dir that owns the instance, not to
 * whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single
 * sessions.json, so instance B's bindings mixed with instance A's — and
 * the suite wrote into the operator's real `~/.xclaw/sessions.json`.
 * Gate-wiring tests passed an explicit `path:` because of this — that
 * override is evidence of the leak, not a fix.
 *
 * Production persist is import-time `configureSessionPersist({})` in
 * sessions/router.mjs (gateway never reconfigured it). Doctor already
 * had cfg in scope and called `defaultSessionsPath()` with no args.
 *
 * `loadConfig()` stamps `paths.configDir` unconditionally
 * (config/load.mjs:187), so a cfg without one is never a real caller.
 * Such a path is `null` rather than guessing at the home dir. Same
 * shape as `defaultStatePath` in alerts.mjs / `resolvePairingStorePath`.
 * Explicit `paths.sessionsFile` / `XCLAW_SESSIONS_FILE` / `opts.path`
 * still win. Gateway boot threads cfg so live still persists.
 */
import fs from "node:fs";
import path from "node:path";

export function resolveSessionsPath(cfg) {
  const explicit = cfg?.paths?.sessionsFile;
  if (typeof explicit === "string" && explicit) return explicit;
  if (process.env.XCLAW_SESSIONS_FILE) return process.env.XCLAW_SESSIONS_FILE;
  const dir = cfg?.paths?.configDir;
  return dir ? path.join(dir, "sessions.json") : null;
}

/** @deprecated alias — same resolver; doctor and router already import this name. */
export function defaultSessionsPath(cfg) {
  return resolveSessionsPath(cfg);
}

export function loadSessionState(filePath) {
  if (!filePath) return { sessions: [], bindings: {} };
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return { sessions: [], bindings: {} };
  }
}

export function saveSessionState(filePath, state) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, filePath);
}
