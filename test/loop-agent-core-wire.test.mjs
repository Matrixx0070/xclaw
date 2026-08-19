import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("loop agent-core wires", () => {
  it("apply script is idempotent and lands needles", () => {
    const apply = path.join(root, "scripts/apply-n12b-loop-agent-core.mjs");
    const r1 = spawnSync(process.execPath, [apply], { encoding: "utf8" });
    assert.equal(r1.status, 0, r1.stderr || r1.stdout);
    const r2 = spawnSync(process.execPath, [apply], { encoding: "utf8" });
    assert.equal(r2.status, 0, r2.stderr || r2.stdout);
    const loopSrc = fs.readFileSync(path.join(root, "src/agent/loop.mjs"), "utf8");
    assert.match(loopSrc, /guardHighRiskReceipt/);
    assert.match(loopSrc, /createCostGovernor/);
    assert.match(loopSrc, /runHallucinationCanary/);
    assert.match(loopSrc, /costGov\.check/);
  });
});
