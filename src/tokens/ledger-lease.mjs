/**
 * Multi-region ledger primary lease (file-based prototype).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { incLeaseMetric } from "./lease-metrics.mjs";

export function leasePath(cfg = {}) {
  const base =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  return path.join(base, "swarm-ledger.lease");
}

export function acquireLease(cfg = {}, { owner = null, ttlMs = 30_000 } = {}) {
  const fp = leasePath(cfg);
  const now = Date.now();
  const id = owner || `gw-${process.pid}`;
  try {
    if (fs.existsSync(fp)) {
      const cur = JSON.parse(fs.readFileSync(fp, "utf8"));
      if (cur.owner !== id && cur.expiresAt > now) {
        incLeaseMetric("lease_held_total");
        return { ok: false, reason: "lease_held", owner: cur.owner, expiresAt: cur.expiresAt };
      }
    }
  } catch {
    /* */
  }
  const lease = { owner: id, at: now, expiresAt: now + ttlMs };
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = fp + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(lease, null, 2));
  fs.renameSync(tmp, fp);
  incLeaseMetric("lease_acquire_total");
  return { ok: true, ...lease };
}

export function releaseLease(cfg = {}, { owner = null } = {}) {
  const fp = leasePath(cfg);
  try {
    const cur = JSON.parse(fs.readFileSync(fp, "utf8"));
    if (owner && cur.owner !== owner) return { ok: false, reason: "not_owner" };
    fs.unlinkSync(fp);
    incLeaseMetric("lease_release_total");
    return { ok: true };
  } catch {
    return { ok: true, reason: "absent" };
  }
}

export function renewLease(cfg = {}, { owner = null, ttlMs = 30_000 } = {}) {
  const fp = leasePath(cfg);
  const id = owner || `gw-${process.pid}`;
  try {
    const cur = JSON.parse(fs.readFileSync(fp, "utf8"));
    if (cur.owner !== id) {
      return { ok: false, reason: "not_owner", owner: cur.owner };
    }
    const now = Date.now();
    const lease = { owner: id, at: cur.at || now, expiresAt: now + ttlMs, renewedAt: now };
    const tmp = fp + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(lease, null, 2));
    fs.renameSync(tmp, fp);
    incLeaseMetric("lease_renew_total");
    return { ok: true, ...lease };
  } catch {
    return acquireLease(cfg, { owner: id, ttlMs });
  }
}

export function readLease(cfg = {}) {
  try {
    return JSON.parse(fs.readFileSync(leasePath(cfg), "utf8"));
  } catch {
    return null;
  }
}

export default { acquireLease, releaseLease, renewLease, readLease, leasePath };
