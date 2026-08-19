import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signGossip, verifyGossip, resetGossipReject } from "../src/cluster/gossip-hmac.mjs";

describe("gossip replay window", () => {
  it("rejects old at", () => {
    resetGossipReject();
    const cfg = { cluster: { gossipHmacSecret: "s", gossipReplayWindowMs: 1000 } };
    const old = new Date(Date.now() - 60_000).toISOString();
    const signed = signGossip({ generation: 1, at: old, region: "us" }, cfg);
    const v = verifyGossip(signed, cfg);
    assert.equal(v.ok, false);
    assert.equal(v.code, "GOSSIP_REPLAY");
  });
});
