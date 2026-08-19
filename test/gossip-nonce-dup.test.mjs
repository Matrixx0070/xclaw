import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { signGossip, verifyGossip, resetGossipReject, getGossipRejectReasons } from "../src/cluster/gossip-hmac.mjs";
import { resetBloom } from "../src/cluster/gossip-bloom.mjs";

describe("nonce dup after verify", () => {
  it("second same nonce fails", () => {
    resetGossipReject();
    resetBloom();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-nd-"));
    const cfg = { paths: { configDir: dir }, cluster: { gossipHmacSecret: "s" } };
    const at = new Date().toISOString();
    const signed = signGossip(
      { generation: 1, owner: "a", region: "us", at, seq: 1, nonce: "deadbeef" },
      cfg
    );
    const v1 = verifyGossip(signed, cfg);
    assert.equal(v1.ok, true);
    const signed2 = signGossip(
      { generation: 2, owner: "a", region: "us", at, seq: 2, nonce: "deadbeef" },
      cfg
    );
    const v2 = verifyGossip(signed2, cfg);
    assert.equal(v2.ok, false);
    assert.equal(v2.reason, "nonce");
    assert.ok(getGossipRejectReasons().nonce >= 1);
  });
});
