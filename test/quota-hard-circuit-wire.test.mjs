import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordHardBlock, guardToolAgainstHardCircuit } from "../src/agent/quota-hard-circuit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("quota hard-circuit wire", () => {
  it("authorize-quota references recordHardBlock", () => {
    const aq = fs.readFileSync(path.join(root, "src/security/authorize-quota.mjs"), "utf8");
    assert.ok(aq.includes("recordHardBlock"));
  });

  it("loop patch exists for guard", () => {
    const patch = fs.readFileSync(
      path.join(root, "patches/quota-hard-circuit-loop.patch"),
      "utf8"
    );
    assert.ok(patch.includes("guardToolAgainstHardCircuit"));
    assert.ok(patch.includes("job: options.job"));
  });

  it("circuit trip blocks tools", () => {
    const job = {};
    recordHardBlock(job, { cfg: { quota: { maxHardBlocksPerJob: 1 } } });
    const g = guardToolAgainstHardCircuit(job);
    assert.equal(g.ok, false);
  });
});
