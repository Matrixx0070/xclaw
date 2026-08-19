/**
 * Single offline autonomy gate: cost-circuit + channel + hardBlockRate ceiling.
 */
import { autonomyCostCircuitCheck } from "./autonomy-cost-circuit.mjs";
import { autonomyStopChannelCheck } from "./autonomy-stop-channel.mjs";
import { hardBlockRateCeilingVerdict } from "./autonomy-metrics.mjs";

export async function runAutonomyOfflineGate(opts = {}) {
  const steps = [];
  const cost = await autonomyCostCircuitCheck();
  steps.push(cost);

  const channel = autonomyStopChannelCheck(opts);
  steps.push({ name: "stop_channel", ...channel });

  const ceiling = hardBlockRateCeilingVerdict(
    { hardBlockRate: opts.hardBlockRate ?? 0 },
    { maxHardBlockRate: opts.maxHardBlockRate ?? 0.25 }
  );
  steps.push({
    name: "hard_block_rate_ceiling",
    ok: !ceiling.exceeded,
    ...ceiling,
  });

  const failed = steps.filter((s) => s.ok === false);
  return {
    ok: failed.length === 0,
    steps,
    failed: failed.map((s) => s.name),
    at: new Date().toISOString(),
  };
}

export default { runAutonomyOfflineGate };
