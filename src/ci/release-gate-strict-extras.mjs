/**
 * Required --strict extras: receipt, dual preflight, kill-switch, resume, quota.
 */
import fs from "node:fs";
import path from "node:path";

export const RELEASE_GATE_STRICT_EXTRA_TESTS = [
  "test/dual-preflight.test.mjs",
  "test/job-dual-preflight.test.mjs",
  "test/receipt-metrics.test.mjs",
  "test/history-receipt-metrics.test.mjs",
  "test/doctor-receipt-metrics.test.mjs",
  "test/stop-proxy.test.mjs",
  "test/gateway-stop-route.test.mjs",
  "test/stop-drain-stats.test.mjs",
  "test/checkpoint-quota-escalate.test.mjs",
  "test/checkpoint-restore-receipt.test.mjs",
  "test/stop-auth.test.mjs",
  "test/doctor-ops-bundle.test.mjs",
  "test/doctor-stop-auth.test.mjs",
  "test/last-drain.test.mjs",
  "test/autonomy-smoke-quota.test.mjs",
  "test/autonomy-smoke-compare.test.mjs",
  "test/doctor-single-port-stop.test.mjs",
  "test/doctor-quota-escalate.test.mjs",
  "test/stop-hmac.test.mjs",
  "test/land-batch-check.test.mjs",
  "test/checkpoint-require-tip.test.mjs",
  "test/doctor-stop-probe.test.mjs",
  "test/doctor-stop-hmac.test.mjs",
  "test/autonomy-metrics-a4.test.mjs",
  "test/ship-pack-land-batch-wire.test.mjs",
  "test/land-all.test.mjs",
  "test/quota-hard-circuit.test.mjs",
  "test/quota-hard-circuit-wire.test.mjs",
  "test/stop-control-auth.test.mjs",
  "test/ws-stop-control.test.mjs",
  "test/tls-stop-parity.test.mjs",
  "test/doctor-auth-refresh-prod.test.mjs",
  "test/release-gate-land-all-applied.test.mjs",
  "test/doctor-stop-health.test.mjs",
  "test/stop-health.test.mjs",
  "test/hard-block-rate-ceiling.test.mjs",
  "test/stop-drain-auth-method.test.mjs",
  "test/cost-preflight-auth-record.test.mjs",
  "test/ship-pack-land-all-preflight.test.mjs",
  "test/doctor-quota-hard-circuit.test.mjs",
  "test/land-remaining-wires.test.mjs",
  "test/readiness-stop.test.mjs",
  "test/doctor-hmac-missing-prod.test.mjs",
  "test/doctor-last-drain-auth.test.mjs",
  "test/openapi-stop.test.mjs",
  "test/land-kill-switch-wires.test.mjs",
  "test/quota-hard-circuit-collector.test.mjs",
  "test/routes-stop.test.mjs",
  "test/stop-sign.test.mjs",
  "test/stop-fire-drill.test.mjs",
  "test/ship-pack-land-ks.test.mjs",
  "test/land-batch-apply-remaining.test.mjs",
  "test/doctor-stop-summary.test.mjs",
  "test/stop-dry-run.test.mjs",
  "test/stop-hmac-canonical.test.mjs",
  "test/ws-stop-last-drain.test.mjs",
  "test/quota-hard-circuit-history.test.mjs",
  "test/openapi-stop-runbook.test.mjs",
  "test/land-batch-n1.test.mjs",
  "test/doctor-stop-fire-drill.test.mjs",
  "test/ship-pack-stop-fire-drill.test.mjs",
  "test/sse-stop-control.test.mjs",
  "test/job-copy-collector.test.mjs",
  "test/openapi-stop-contract.test.mjs",
  "test/stop-help.test.mjs",
  "test/land-batch-n2.test.mjs",
];

export function listStrictExtraTests(root) {
  return RELEASE_GATE_STRICT_EXTRA_TESTS.filter((f) =>
    fs.existsSync(path.join(root, f))
  );
}

export default { RELEASE_GATE_STRICT_EXTRA_TESTS, listStrictExtraTests };
