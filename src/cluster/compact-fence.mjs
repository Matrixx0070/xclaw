/**
 * Monotonic compact fence — reject stale holders.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function fencePath(cfg = {}, region = "local") {
  const base =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  const r = String(region || "local").replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(base, `compact-fence.${r}.json`);
}

export function readFence(cfg = {}, region = "local") {
  try {
    return JSON.parse(fs.readFileSync(fencePath(cfg, region), "utf8"));
  } catch {
    return { fence: 0, owner: null };
  }
}

export function bumpFence(cfg = {}, region = "local", { owner = null } = {}) {
  const cur = readFence(cfg, region);
  const next = {
    fence: (Number(cur.fence) || 0) + 1,
    owner: owner || cur.owner || `gw-${process.pid}`,
    at: new Date().toISOString(),
  };
  const fp = fencePath(cfg, region);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp + ".tmp", JSON.stringify(next));
  fs.renameSync(fp + ".tmp", fp);
  return next;
}

export function acceptFence(cfg = {}, region, fence) {
  const cur = readFence(cfg, region);
  const f = Number(fence);
  if (!Number.isFinite(f)) return { ok: false, code: "STALE_FENCE", reason: "missing" };
  if (f < (Number(cur.fence) || 0)) {
    return { ok: false, code: "STALE_FENCE", current: cur.fence, fence: f };
  }
  return { ok: true, fence: Math.max(cur.fence || 0, f) };
}

export default { readFence, bumpFence, acceptFence, fencePath };
