/**
 * Coordinator generation / fence token for split-brain protection.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function generationPath(cfg = {}) {
  const base =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  return path.join(base, "cluster-generation.json");
}

export function readGeneration(cfg = {}) {
  try {
    return JSON.parse(fs.readFileSync(generationPath(cfg), "utf8"));
  } catch {
    return { generation: 0, owner: null, at: null };
  }
}

export function bumpGeneration(cfg = {}, { owner = null } = {}) {
  const cur = readGeneration(cfg);
  const next = {
    generation: (Number(cur.generation) || 0) + 1,
    owner: owner || cur.owner || `gw-${process.pid}`,
    at: new Date().toISOString(),
  };
  const fp = generationPath(cfg);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = fp + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, fp);
  return next;
}

export function acceptGeneration(cfg = {}, remoteGen) {
  const local = readGeneration(cfg);
  const g = Number(remoteGen);
  if (!Number.isFinite(g)) {
    return { ok: false, code: "STALE_GENERATION", reason: "missing_generation" };
  }
  if (g < (Number(local.generation) || 0)) {
    return { ok: false, code: "STALE_GENERATION", local: local.generation, remote: g };
  }
  if (g > (Number(local.generation) || 0)) {
    const fp = generationPath(cfg);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const next = { generation: g, owner: local.owner, at: new Date().toISOString(), source: "remote" };
    fs.writeFileSync(fp + ".tmp", JSON.stringify(next, null, 2));
    fs.renameSync(fp + ".tmp", fp);
  }
  return { ok: true, generation: g };
}

export default { readGeneration, bumpGeneration, acceptGeneration, generationPath };
