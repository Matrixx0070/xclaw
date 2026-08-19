/**
 * Doctor: swarm cost ledger snapshot.
 */
import { ledgerSnapshot, dailyHardUsd } from "../tokens/swarm-ledger.mjs";

export function pushSwarmLedgerChecks(push, cfg = {}) {
  try {
    const snap = ledgerSnapshot(cfg);
    const hard = dailyHardUsd(cfg);
    const reserved = Number(snap.reservedUsd) || 0;
    const spent = Number(snap.spentUsd) || 0;
    const pressure = hard > 0 ? (spent + reserved) / hard : 0;
    const status = pressure > 0.95 ? "warn" : "ok";
    push(
      "cost.swarmLedger",
      status,
      `swarm ledger day=${snap.day} spent=$${spent.toFixed(4)} reserved=$${reserved.toFixed(4)} hard=$${hard}`,
      { ...snap, hardUsd: hard, pressure }
    );
  } catch (e) {
    push("cost.swarmLedger", "warn", `swarm ledger unavailable: ${e.message || e}`, {});
  }
}

export default { pushSwarmLedgerChecks };
