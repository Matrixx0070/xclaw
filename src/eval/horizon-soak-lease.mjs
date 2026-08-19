/**
 * Soak job lease — file backend (local exclusivity).
 */
import fs from "node:fs";
import path from "node:path";

const held = new Set();

export function soakLeaseDir(base) {
  return path.resolve(base || process.cwd(), ".xclaw", "soak-leases");
}

export function soakLeasePath(jobId, base) {
  const id = String(jobId || "default").replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(soakLeaseDir(base), `${id}.json`);
}

export function soakLeaseTtlMs(opts = {}) {
  const n = Number(
    opts.ttlMs ?? process.env.XCLAW_SOAK_LEASE_TTL_MS ?? 30_000
  );
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

export function readSoakLease(jobId, opts = {}) {
  try {
    return JSON.parse(
      fs.readFileSync(soakLeasePath(jobId, opts.base), "utf8")
    );
  } catch {
    return null;
  }
}

export function acquireSoakLease(jobId, opts = {}) {
  const owner = opts.owner || `soak-${process.pid}`;
  const now = Date.now();
  const ttl = soakLeaseTtlMs(opts);
  const cur = readSoakLease(jobId, opts);
  if (cur && cur.owner !== owner && now - (cur.at || 0) < (cur.ttl || ttl)) {
    return {
      ok: false,
      code: "LEASE_HELD",
      owner: cur.owner,
      jobId: String(jobId),
      backend: "file",
    };
  }
  const next = {
    owner,
    jobId: String(jobId),
    at: now,
    ttl,
    backend: "file",
  };
  const fp = soakLeasePath(jobId, opts.base);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp + ".tmp", JSON.stringify(next) + "\n");
  fs.renameSync(fp + ".tmp", fp);
  held.add(`${fp}:${owner}`);
  return {
    ok: true,
    owner,
    jobId: String(jobId),
    at: now,
    ttl,
    backend: "file",
  };
}

export function renewSoakLease(jobId, opts = {}) {
  const owner = opts.owner || `soak-${process.pid}`;
  const cur = readSoakLease(jobId, opts);
  if (!cur || cur.owner !== owner) {
    return { ok: false, code: "LEASE_NOT_HELD", jobId: String(jobId) };
  }
  return acquireSoakLease(jobId, { ...opts, owner });
}

export function releaseSoakLease(jobId, opts = {}) {
  const owner = opts.owner || `soak-${process.pid}`;
  const fp = soakLeasePath(jobId, opts.base);
  const cur = readSoakLease(jobId, opts);
  if (cur && cur.owner !== owner) {
    return { ok: false, code: "LEASE_NOT_OWNER", owner: cur.owner };
  }
  try {
    fs.unlinkSync(fp);
  } catch {
    /* missing ok */
  }
  held.delete(`${fp}:${owner}`);
  return { ok: true, released: true, jobId: String(jobId), owner };
}

export function listHeldSoakLeases(opts = {}) {
  const dir = soakLeaseDir(opts.base);
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    const now = Date.now();
    const out = [];
    for (const f of files) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        const ttl = j.ttl || soakLeaseTtlMs(opts);
        if (now - (j.at || 0) < ttl) out.push(j);
      } catch {
        /* skip */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export default {
  acquireSoakLease,
  renewSoakLease,
  releaseSoakLease,
  readSoakLease,
  listHeldSoakLeases,
  soakLeaseTtlMs,
};
