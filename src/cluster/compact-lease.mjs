/**
 * File compact lease — one gateway GCs a shard.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { bumpFence, readFence } from "./compact-fence.mjs";

const held = new Set();

export function leaseDir(cfg = {}) {
  return (
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw")
  );
}

export function leasePath(cfg, region = "local") {
  const r = String(region || "local").replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(leaseDir(cfg), `compact-lease.${r}.json`);
}

export function leaseTtlMs(cfg = {}) {
  const n = Number(
    cfg?.cluster?.compactLeaseTtlMs ?? process.env.XCLAW_COMPACT_LEASE_TTL_MS ?? 15_000
  );
  return Number.isFinite(n) && n > 0 ? n : 15_000;
}

export function readLease(cfg, region = "local") {
  try {
    return JSON.parse(fs.readFileSync(leasePath(cfg, region), "utf8"));
  } catch {
    return null;
  }
}

export function acquireCompactLease(cfg = {}, region = "local", { owner = null } = {}) {
  const id = owner || cfg?.cluster?.owner || `gw-${process.pid}`;
  const now = Date.now();
  const ttl = leaseTtlMs(cfg);
  const cur = readLease(cfg, region);
  if (cur && cur.owner !== id && now - (cur.at || 0) < ttl) {
    return { ok: false, code: "LEASE_HELD", owner: cur.owner, region };
  }
  const next = { owner: id, region, at: now, ttl };
  const fp = leasePath(cfg, region);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp + ".tmp", JSON.stringify(next));
  fs.renameSync(fp + ".tmp", fp);
  held.add(`${fp}:${id}`);
  // Monotonic fencing token: bump on a genuine hand-over, reuse it on a
  // same-owner renewal so renewals do not inflate the fence.
  const fence =
    cur && cur.owner === id
      ? readFence(cfg, region).fence || bumpFence(cfg, region, { owner: id }).fence
      : bumpFence(cfg, region, { owner: id }).fence;
  return { ok: true, owner: id, region, at: now, fence };
}

export function renewCompactLease(cfg = {}, region = "local", { owner = null } = {}) {
  const id = owner || cfg?.cluster?.owner || `gw-${process.pid}`;
  const cur = readLease(cfg, region);
  if (!cur || cur.owner !== id) return { ok: false, code: "LEASE_NOT_HELD" };
  return acquireCompactLease(cfg, region, { owner: id });
}

export function releaseCompactLease(cfg = {}, region = "local", { owner = null } = {}) {
  const id = owner || cfg?.cluster?.owner || `gw-${process.pid}`;
  const cur = readLease(cfg, region);
  if (cur && cur.owner !== id) return { ok: false, code: "LEASE_NOT_OWNER" };
  try {
    fs.unlinkSync(leasePath(cfg, region));
  } catch {
    /* */
  }
  held.delete(`${leasePath(cfg, region)}:${id}`);
  return { ok: true, region };
}

export function compactLeasesHeld() {
  return held.size;
}

export default {
  acquireCompactLease,
  renewCompactLease,
  releaseCompactLease,
  readLease,
  compactLeasesHeld,
};
