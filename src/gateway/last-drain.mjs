/**
 * Remember last POST /stop drain for doctor (memory + disk).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let last = null;

export function lastDrainPath(cfg = {}) {
  const base = cfg.paths?.configDir || process.env.XCLAW_CONFIG_DIR || path.join(os.homedir(), ".xclaw");
  return path.join(base, "last-drain.json");
}

export function recordLastDrain(drain, extra = {}) {
  last = { ...drain, at: extra.at || new Date().toISOString(), ...extra };
  delete last.cfg;
  const fp = extra.path || lastDrainPath(extra.cfg || {});
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
