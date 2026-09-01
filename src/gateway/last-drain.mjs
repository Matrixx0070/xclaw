/**
 * Remember last POST /stop drain for doctor (memory + disk).
 *
 * last-drain.json belongs to the config dir that owns the instance, not
 * to whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single
 * last-drain.json, so instance B's doctor reported instance A's last stop —
 * and the suite wrote into the operator's real `~/.xclaw/last-drain.json`.
 *
 * Production stop writers (`recordLastDrain(drain, { cfg })` at stop-route /
 * ws-stop-control / sse-stop-control) already had cfg in scope. `loadConfig()`
 * stamps `paths.configDir` unconditionally (config/load.mjs:187), so a
 * cfg without one is never a real caller. Such a path is `null` rather
 * than guessing at the home dir. Same shape as `leasePath`. Honour
 * existing `XCLAW_CONFIG_DIR`. `recordLastDrain` no-ops a null path (do
 * not `mkdir(null)` / `path.dirname(null)`); in-memory `last` still set.
 */
import fs from "node:fs";
import path from "node:path";

let last = null;

/**
 * Honour `paths.configDir` then `XCLAW_CONFIG_DIR` then null.
 * No home fallback.
 */
export function lastDrainPath(cfg = {}) {
  const dir = cfg.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return dir ? path.join(dir, "last-drain.json") : null;
}

export function recordLastDrain(drain, extra = {}) {
  last = { ...drain, at: extra.at || new Date().toISOString(), ...extra };
  delete last.cfg;
  const fp = extra.path || lastDrainPath(extra.cfg || {});
  if (!fp) return last;
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const tmp = fp + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(last, null, 2));
    fs.renameSync(tmp, fp);
    last.path = fp;
  } catch {
    /* disk optional */
  }
  return last;
}

export function loadLastDrain(cfg = {}) {
  if (last) return last;
  const fp = lastDrainPath(cfg);
  if (!fp) return null;
  try {
    last = JSON.parse(fs.readFileSync(fp, "utf8"));
    return last;
  } catch {
    return null;
  }
}

export function getLastDrain(cfg = {}) {
  return last || loadLastDrain(cfg);
}

/** Attach swarm tree id for cross-agent stop audit. */
export function withSwarmId(drain, swarmId) {
  if (!drain || typeof drain !== "object") return drain;
  if (swarmId != null && swarmId !== "") drain.swarmId = swarmId;
  return drain;
}

export default { recordLastDrain, getLastDrain, loadLastDrain, lastDrainPath, withSwarmId };
