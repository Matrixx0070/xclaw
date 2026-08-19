import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signGossip, verifyGossip, resetGossipReject, getGossipRejectTotal } from "../src/cluster/gossip-hmac.mjs";

describe("gossip hmac", () => {
  it("accepts valid sig", () => {
    resetGossipReject();
    const cfg = { cluster: { gossipHmacSecret: "s3cret" } };
    const signed = signGossip({ generation: 3, owner: "a", region: "us", at: "t" }, cfg);
    const v = verifyGossip(signed, cfg);
    assert.equal(v.ok, true);
  });
  it("prod rejects unsigned", () => {
    resetGossipReject();
    const cfg = { profile: "prod", cluster: { requireGossipHmac: true, gossipHmacSecret: "s3cret" } };
    const v = verifyGossip({ generation: 9, region: "evil" }, cfg);
    assert.equal(v.ok, false);
    assert.equal(v.code, "GOSSIP_HMAC_INVALID");
    assert.ok(getGossipRejectTotal() >= 1);
  });
  it("prod rejects bad sig", () => {
    const cfg = { profile: "prod", cluster: { gossipHmacSecret: "s3cret" } };
    const signed = signGossip({ generation: 1, at: "t" }, cfg);
    signed.sig = "00".repeat(32);
    const v = verifyGossip(signed, cfg);
    assert.equal(v.ok, false);
  });
});
