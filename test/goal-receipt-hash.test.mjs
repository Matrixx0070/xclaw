import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildGoalReceipt } from "../src/agent/goal-loop.mjs";
import { GENESIS_HASH, verifyToolHashChain, buildToolHashChain } from "../src/agent/tool-hash-chain.mjs";

describe("goal receipt hash tip", () => {
  it("empty tools uses genesis tip", () => {
    const r = buildGoalReceipt({ goal: "x", toolTrace: [] });
    assert.equal(r.toolHashTip, GENESIS_HASH);
    assert.ok(r.toolHashVersion >= 1);
  });

  it("embeds matching chain tip", () => {
    const trace = [
      { id: "t1", name: "xclaw_bash", status: "ok", result: "hi" },
      { id: "t2", name: "xclaw_file_read", status: "ok", result: "data" },
    ];
    const r = buildGoalReceipt({ goal: "do it", toolTrace: trace, finalText: "done" });
    const chain = buildToolHashChain(trace);
    assert.equal(r.toolHashTip, chain.tip);
    assert.notEqual(r.toolHashTip, GENESIS_HASH);
    assert.equal(verifyToolHashChain(chain.entries).ok, true);
  });
});
