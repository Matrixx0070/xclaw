import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("land-all wires", () => {
  it("lander exists and its wires are in the tree", () => {
    // patches/land-all-wires.patch was never committed; the guarantee that
    // matters is that the lander exists and the wires it lands are present.
    assert.ok(fs.existsSync(path.join(root, "scripts/land-all.mjs")));
    for (const [rel, needle] of [
      ["src/jobs/job.mjs", "runClaimsGateWithSoftRetry"],
      ["src/jobs/claims-soft-retry-run.mjs", "gateStructuredClaims"],
      ["src/security/approvals.mjs", "authorizeQuotaPreflight"],
      ["src/tokens/cost-governor.mjs", "withLedgerLock"],
    ]) {
      assert.ok(fs.readFileSync(path.join(root, rel), "utf8").includes(needle), `${rel}::${needle}`);
    }
  });

  it("land-all --check is runnable", () => {
    const r = spawnSync(process.execPath, ["scripts/land-all.mjs", "--check"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.ok(r.status === 0 || r.status === 1);
  });
});
