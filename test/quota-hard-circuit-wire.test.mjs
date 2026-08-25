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

  // The loop side used to be "covered" here by asserting that
  // patches/quota-hard-circuit-loop.patch mentions guardToolAgainstHardCircuit.
  // That file is the input to a past migration, not the shipped code: the guard
  // could be deleted from src/agent/loop.mjs and the assertion still passed.
  // The real coverage — a tripped circuit stops dispatch, an untripped one does
  // not — lives in test/loop-budget-enforcement.test.mjs.

  it("circuit trip blocks tools", () => {
    const job = {};
    recordHardBlock(job, { cfg: { quota: { maxHardBlocksPerJob: 1 } } });
    const g = guardToolAgainstHardCircuit(job);
    assert.equal(g.ok, false);
  });
});
