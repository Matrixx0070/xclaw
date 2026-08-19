import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBloom, bloomAdd, bloomMightContain, acceptNonce } from "../src/cluster/gossip-bloom.mjs";

describe("gossip bloom", () => {
  it("detects added nonce", () => {
    const b = createBloom({ bits: 512, hashes: 3 });
    assert.equal(bloomMightContain(b, "abc"), false);
    bloomAdd(b, "abc");
    assert.equal(bloomMightContain(b, "abc"), true);
    const r = acceptNonce("abc", b);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "nonce");
  });
});
