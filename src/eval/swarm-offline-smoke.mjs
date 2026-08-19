/**
 * Offline swarm smoke: parent + 2 children mock, score.
 */
import { createSwarmReceipt, attachChildReceipt } from "../jobs/swarm-receipt.mjs";
import { scoreSwarm } from "./swarm-eval.mjs";
import { reserveUsd, settleUsd } from "../tokens/swarm-ledger.mjs";

export async function runSwarmOfflineSmoke(cfg = {}) {
  const swarmId = `smoke-${Date.now().toString(36)}`;
  const swarm = createSwarmReceipt(swarmId);
  reserveUsd(cfg, { swarmId, childId: "c1", usd: 0.05 });
  reserveUsd(cfg, { swarmId, childId: "c2", usd: 0.05 });
  attachChildReceipt(swarm, { id: "c1", pass: true, usd: 0.04, status: "succeeded" });
  attachChildReceipt(swarm, { id: "c2", pass: true, usd: 0.03, status: "succeeded" });
  settleUsd(cfg, { swarmId, childId: "c1", usd: 0.04 });
  settleUsd(cfg, { swarmId, childId: "c2", usd: 0.03 });
  const score = scoreSwarm(swarm);
  return { ok: score.ok, swarmId, score, childCount: 2 };
}

export default { runSwarmOfflineSmoke };
