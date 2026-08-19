import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signGossip, verifyGossip } from "../src/cluster/gossip-hmac.mjs";

describe("gossip key rotation", () => {
  it("signs with current, verifies previous", () => {
    const current = { cluster: { gossipHmacSecrets: ["new-secret", "old-secret"] } };
    const previousOnly = { cluster: { gossipHmacSecret: "old-secret" } };
    const signedOld = signGossip(
      { generation: 2, at: new Date().toISOString(), region: "us" },
      previousOnly
    );
    const v = verifyGossip(signedOld, current);
    assert.equal(v.ok, true);
    assert.equal(v.rotated, true);
    const signedNew = signGossip(
      { generation: 3, at: new Date().toISOString(), region: "us" },
      current
    );
    const v2 = verifyGossip(signedNew, current);
    assert.equal(v2.ok, true);
    assert.equal(v2.rotated, false);
  });
});
