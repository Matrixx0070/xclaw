import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBloom, bloomAdd, saveBloom, loadBloom, bloomMightContain } from "../src/cluster/gossip-bloom.mjs";

describe("bloom persist", () => {
  it("save then load still contains nonce", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-bp-"));
    const cfg = { paths: { configDir: dir } };
    const b = createBloom({ bits: 256, hashes: 3 });
    bloomAdd(b, "persist-me");
    saveBloom(b, cfg);
    assert.ok(fs.existsSync(path.join(dir, "gossip-bloom.bin")));
    const loaded = loadBloom(cfg);
    assert.equal(bloomMightContain(loaded, "persist-me"), true);
  });
  it("prod corrupt fails closed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-bc-"));
    const cfg = { paths: { configDir: dir } };
    fs.writeFileSync(path.join(dir, "gossip-bloom.bin"), "not-a-bloom");
    const r = loadBloom(cfg, { prod: true });
    assert.equal(r.ok, false);
    assert.equal(r.code, "BLOOM_CORRUPT");
  });
});
