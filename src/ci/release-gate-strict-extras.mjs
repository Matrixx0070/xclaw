/**
 * Required --strict extras: receipt metrics + dual preflight surface.
 */
import fs from "node:fs";
import path from "node:path";

export const RELEASE_GATE_STRICT_EXTRA_TESTS = [
  "test/dual-preflight.test.mjs",
  "test/job-dual-preflight.test.mjs",
  "test/receipt-metrics.test.mjs",
  "test/history-receipt-metrics.test.mjs",
  "test/doctor-receipt-metrics.test.mjs",
];

export function listStrictExtraTests(root) {
  return RELEASE_GATE_STRICT_EXTRA_TESTS.filter((f) =>
    fs.existsSync(path.join(root, f))
  );
}

export default { RELEASE_GATE_STRICT_EXTRA_TESTS, listStrictExtraTests };
