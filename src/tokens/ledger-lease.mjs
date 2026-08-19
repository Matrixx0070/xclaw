/**
 * Multi-region ledger primary lease prototype (file-based).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
  return { ok: true, ...lease };
}

export function releaseLease(cfg = {}, { owner = null } = {}) {
  const fp = leasePath(cfg);
  try {
    const cur = JSON.parse(fs.readFileSync(fp, "utf8"));
    if (owner && cur.owner !== owner) return { ok: false, reason: "not_owner" };
    fs.unlinkSync(fp);
    return { ok: true };
  } catch {
    return { ok: true, reason: "absent" };
  }
}

export default { acquireLease, releaseLease, leasePath };
