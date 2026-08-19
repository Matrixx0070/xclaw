/**
 * Shared cost ledger for swarm — reserve on spawn, settle on finish.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function ledgerPath(cfg = {}) {
  const base =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  return path.join(base, "swarm-cost-ledger.json");
}

function load(cfg = {}) {
  try {
    return JSON.parse(fs.readFileSync(ledgerPath(cfg), "utf8"));
  } catch {
    return { day: dayKey(), account: "default", reservedUsd: 0, spentUsd: 0, entries: [] };
  }
}

function save(cfg, data) {
  const fp = ledgerPath(cfg);
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

export function reserveUsd(cfg, { swarmId, childId, usd = 0 } = {}) {
  let data = rollover(load(cfg));
  const amount = Math.max(0, Number(usd) || 0);
  data.reservedUsd = (data.reservedUsd || 0) + amount;
  data.entries.push({
    type: "reserve",
    swarmId: swarmId || null,
    childId: childId || null,
    usd: amount,
    at: new Date().toISOString(),
  });
  save(cfg, data);
  return { ok: true, reservedUsd: data.reservedUsd, spentUsd: data.spentUsd };
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

export default { reserveUsd, settleUsd, ledgerSnapshot, ledgerPath };
