/**
 * Multi-region ledger primary lease (file-based prototype).
 *
 * swarm-ledger.lease belongs to the config dir that owns the instance, not
 * to whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single
 * lease file, so instance B could not reserve because instance A held it —
 * and the suite wrote into the operator's real `~/.xclaw/swarm-ledger.lease`.
 *
 * Production reserve (`acquireLease(cfg)` from `reserveUsd(cfg)`) and
 * doctor (`readLease(cfg)`) already had cfg in scope. `loadConfig()`
 * stamps `paths.configDir` unconditionally (config/load.mjs:187), so a
 * cfg without one is never a real caller. Such a path is `null` rather
 * than guessing at the home dir. Same shape as `ledgerPath`. Honour
 * existing `XCLAW_CONFIG_DIR`. `acquireLease` / `renewLease` no-op a
 * null path (do not `mkdir(null)` / `path.dirname(null)`).
 */
import fs from "node:fs";
import path from "node:path";
import { incLeaseMetric } from "./lease-metrics.mjs";

/**
 * Honour `paths.configDir` then `XCLAW_CONFIG_DIR` then null.
 * No home fallback.
 */
export function leasePath(cfg = {}) {
  const dir = cfg.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return dir ? path.join(dir, "swarm-ledger.lease") : null;
}

export function acquireLease(cfg = {}, { owner = null, ttlMs = 30_000 } = {}) {
  const fp = leasePath(cfg);
  const id = owner || `gw-${process.pid}`;
  if (!fp) return { ok: true, skipped: true, owner: id, file: null };
  const now = Date.now();
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
  if (!fp) return { ok: true, reason: "absent" };
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
  if (!fp) return { ok: true, skipped: true, owner: id, file: null };
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
  const fp = leasePath(cfg);
  if (!fp) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

export default { acquireLease, releaseLease, renewLease, readLease, leasePath };
