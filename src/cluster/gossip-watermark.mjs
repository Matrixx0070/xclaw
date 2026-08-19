/**
 * Generation gossip watermark — persist max(local, remote) per region.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function watermarkPath(cfg = {}) {
  const base =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  return path.join(base, "cluster-gossip.json");
}

export function readWatermark(cfg = {}) {
  try {
    return JSON.parse(fs.readFileSync(watermarkPath(cfg), "utf8"));
  } catch {
    return { watermark: 0, regions: {}, at: null };
  }
}

export function mergeGossip(cfg = {}, { generation = 0, region = "local", owner = null } = {}) {
  const cur = readWatermark(cfg);
  const g = Number(generation) || 0;
  const regions = { ...(cur.regions || {}) };
  const prev = Number(regions[region]?.generation) || 0;
  if (g >= prev) {
    regions[region] = { generation: g, owner: owner || null, at: new Date().toISOString() };
  }
  const watermark = Math.max(
    Number(cur.watermark) || 0,
    ...Object.values(regions).map((r) => Number(r.generation) || 0)
  );
  const next = { watermark, regions, at: new Date().toISOString() };
  const fp = watermarkPath(cfg);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp + ".tmp", JSON.stringify(next, null, 2));
  fs.renameSync(fp + ".tmp", fp);
  return next;
}

export function acceptAgainstWatermark(cfg = {}, remoteGen) {
  const w = readWatermark(cfg);
  const g = Number(remoteGen);
  if (!Number.isFinite(g)) {
    return { ok: false, code: "STALE_GENERATION", reason: "missing_generation" };
  }
  if (g < (Number(w.watermark) || 0)) {
    return { ok: false, code: "STALE_GENERATION", watermark: w.watermark, remote: g };
  }
  return { ok: true, watermark: Math.max(w.watermark || 0, g) };
}

export default { readWatermark, mergeGossip, acceptAgainstWatermark, watermarkPath };
