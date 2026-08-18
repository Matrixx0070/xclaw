import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildToolHashChain } from "../src/agent/tool-hash-chain.mjs";
import {
  verifyCheckpointToolHash,
  CHECKPOINT_HASH_CODES,
} from "../src/jobs/checkpoint-hash-verify.mjs";

describe("checkpoint toolHashTip verify", () => {
  it("ok when tip matches trace", () => {
    const toolTrace = [
      { name: "bash", args: { command: "echo 1" }, result: "1" },
    ];
    const tip = buildToolHashChain(toolTrace).tip;
    const r = verifyCheckpointToolHash({ toolTrace, toolHashTip: tip });
    assert.equal(r.ok, true);
    assert.equal(r.code, CHECKPOINT_HASH_CODES.OK);
  });

  it("mismatch when tip wrong", () => {
    const toolTrace = [{ name: "bash", result: "x" }];
    const r = verifyCheckpointToolHash({
      toolTrace,
      toolHashTip: "deadbeef".repeat(8),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, CHECKPOINT_HASH_CODES.MISMATCH);
  });

  it("legacy missing tip soft-ok by default", () => {
    const r = verifyCheckpointToolHash({
      toolTrace: [{ name: "bash", result: "x" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.legacy, true);
  });

  it("requireTip fails when tip missing", () => {
    const r = verifyCheckpointToolHash(
      { toolTrace: [{ name: "bash", result: "x" }] },
      { requireTip: true }
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, CHECKPOINT_HASH_CODES.MISSING_TIP);
  });
});
