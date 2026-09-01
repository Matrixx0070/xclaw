/**
 * Shared cost ledger for swarm — reserve on spawn, settle on finish, daily hard cap.
 *
 * swarm-cost-ledger.json belongs to the config dir that owns the instance, not
 * to whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single daily
 * swarm cap, so instance B's children mixed with instance A's budget — and
 * the suite wrote into the operator's real `~/.xclaw/swarm-cost-ledger.json`.
 *
 * Production jobs (`reserveUsd(cfg)` / `settleUsd(cfg)`), doctor, stop-health,
 * and eval smoke already had cfg in scope. `loadConfig()` stamps
 * `paths.configDir` unconditionally (config/load.mjs:187), so a cfg without
 * one is never a real caller. Such a path is `null` rather than guessing at
 * the home dir. Same shape as `governorLedgerPath` / `accountsDir`. Honour
 * existing `XCLAW_CONFIG_DIR`. `save` no-ops a null path (do not
 * `mkdir(null)` / `path.dirname(null)`).
 */
import fs from "node:fs";
import path from "node:path";
import { acquireLease } from "./ledger-lease.mjs";
import { acquireLeaseViaBackend } from "./lease-backend.mjs";

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function emptyLedger() {
  return { day: dayKey(), account: "default", reservedUsd: 0, spentUsd: 0, entries: [] };
}

/**
 * Honour `paths.configDir` then `XCLAW_CONFIG_DIR` then null.
 * No home fallback.
 */
export function ledgerPath(cfg = {}) {
  const dir = cfg.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return dir ? path.join(dir, "swarm-cost-ledger.json") : null;
}

function load(cfg = {}) {
  const fp = ledgerPath(cfg);
  if (!fp) return emptyLedger();
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return emptyLedger();
  }
}

function save(cfg, data) {
  const fp = ledgerPath(cfg);
  if (!fp) return;
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = fp + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, fp);
}

function rollover(data) {
  const d = dayKey();
  if (data.day !== d) {
    return { day: d, account: data.account || "default", reservedUsd: 0, spentUsd: 0, entries: [] };
  }
  return data;
}

export function dailyHardUsd(cfg = {}) {
  const n = Number(
    cfg?.tokens?.dailyHardUsd ??
      cfg?.cost?.dailyHardUsd ??
      process.env.XCLAW_DAILY_HARD_USD ??
      50
  );
  // `n > 0 ? n : 50` conflated "spend nothing" with "not configured": an
  // operator setting the cap to 0 got a $50 budget on the path job.mjs
  // reserves against — the strictest setting yielding nearly the loosest.
  // A negative cap is nonsense, so it clamps closed rather than widening.
  // Only a value that is not a number at all falls back.
  return Number.isFinite(n) ? Math.max(0, n) : 50;
}

/**
 * Share of the daily cap already committed. Both reporters (gateway /health
 * and `xclaw doctor`) used to inline `hard > 0 ? … : 0`, which reads a
 * fully-committed ledger under a zero cap as 0 — i.e. healthy. Zero caps
 * became reachable when dailyHardUsd stopped discarding them.
 * @returns {number} 0..1+ — 1 when the cap is 0 and anything is committed
 */
export function ledgerPressure(spentUsd = 0, reservedUsd = 0, hardUsd = 0) {
  const committed = (Number(spentUsd) || 0) + (Number(reservedUsd) || 0);
  const hard = Number(hardUsd) || 0;
  if (hard > 0) return committed / hard;
  return committed > 0 ? 1 : 0;
}

export function leaseRequired(cfg = {}) {
  return (
    cfg?.tokens?.ledgerLease === true ||
    process.env.XCLAW_LEDGER_LEASE === "1"
  );
}

export function reserveUsd(cfg, { swarmId, childId, usd = 0, leaseOwner = null, skipLease = false } = {}) {
  if (leaseRequired(cfg) && !skipLease) {
    const lease = acquireLease(cfg, { owner: leaseOwner || `gw-${process.pid}` });
    if (!lease.ok) {
      return {
        ok: false,
        code: "SWARM_LEDGER_LEASE_HELD",
        message: `swarm ledger lease held by ${lease.owner || "other"}`,
        lease,
      };
    }
  }
  let data = rollover(load(cfg));
  const amount = Math.max(0, Number(usd) || 0);
  const hard = dailyHardUsd(cfg);
  const projected = (data.spentUsd || 0) + (data.reservedUsd || 0) + amount;
  if (projected > hard) {
    return {
      ok: false,
      code: "SWARM_LEDGER_HARD_CAP",
      message: `swarm ledger hard cap: projected $${projected.toFixed(4)} > $${hard}`,
      reservedUsd: data.reservedUsd,
      spentUsd: data.spentUsd,
      hardUsd: hard,
    };
  }
  data.reservedUsd = (data.reservedUsd || 0) + amount;
  data.entries.push({
    type: "reserve",
    swarmId: swarmId || null,
    childId: childId || null,
    usd: amount,
    at: new Date().toISOString(),
  });
  save(cfg, data);
  return { ok: true, reservedUsd: data.reservedUsd, spentUsd: data.spentUsd, hardUsd: hard };
}

export function settleUsd(cfg, { swarmId, childId, usd = 0 } = {}) {
  let data = rollover(load(cfg));
  const amount = Math.max(0, Number(usd) || 0);
  data.spentUsd = (data.spentUsd || 0) + amount;
  data.reservedUsd = Math.max(0, (data.reservedUsd || 0) - amount);
  data.entries.push({
    type: "settle",
    swarmId: swarmId || null,
    childId: childId || null,
    usd: amount,
    at: new Date().toISOString(),
  });
  save(cfg, data);
  return { ok: true, reservedUsd: data.reservedUsd, spentUsd: data.spentUsd };
}

export function ledgerSnapshot(cfg = {}) {
  return rollover(load(cfg));
}

/**
 * Async reserve — supports Redis lease backend.
 */
export async function reserveUsdAsync(cfg, opts = {}) {
  const { leaseOwner = null } = opts;
  if (leaseRequired(cfg)) {
    const lease = await acquireLeaseViaBackend(cfg, {
      owner: leaseOwner || `gw-${process.pid}`,
    });
    if (!lease.ok) {
      return {
        ok: false,
        code: lease.code || "SWARM_LEDGER_LEASE_HELD",
        message: lease.message || `swarm ledger lease held by ${lease.owner || "other"}`,
        lease,
      };
    }
  }
  return reserveUsd(cfg, { ...opts, skipLease: true });
}

export default {
  reserveUsd,
  reserveUsdAsync,
  settleUsd,
  ledgerSnapshot,
  ledgerPath,
  dailyHardUsd,
  ledgerPressure,
  leaseRequired,
};
