import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { signGossip, verifyGossip, resetGossipReject, getGossipRejectReasons } from "../src/cluster/gossip-hmac.mjs";

describe("signed seq replay", () => {
  it("second same seq fails after hmac", () => {
    resetGossipReject();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-sr-"));
    const cfg = { paths: { configDir: dir }, cluster: { gossipHmacSecret: "s" } };
    const at = new Date().toISOString();
    const p = { generation: 4, owner: "gw-1", region: "us", at, seq: 3 };
    const signed = signGossip(p, cfg);
    const v1 = verifyGossip(signed, cfg);
    assert.equal(v1.ok, true);
    const v2 = verifyGossip(signed, cfg);
    assert.equal(v2.ok, false);
    assert.equal(v2.reason, "seq");
    assert.ok(getGossipRejectReasons().seq >= 1);
  });
});
