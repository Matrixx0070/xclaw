import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acceptSeq, nextSeq, listSeqShards } from "../src/cluster/gossip-seq.mjs";

describe("seq shards by region", () => {
  it("two regions do not share seq", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-sh-"));
    const cfg = { paths: { configDir: dir } };
    assert.equal(acceptSeq(cfg, { owner: "a", seq: 1, region: "us" }).ok, true);
    assert.equal(acceptSeq(cfg, { owner: "a", seq: 1, region: "eu" }).ok, true);
    assert.equal(acceptSeq(cfg, { owner: "a", seq: 1, region: "us" }).ok, false);
    assert.ok(fs.existsSync(path.join(dir, "gossip-seq.us.json")));
    assert.ok(fs.existsSync(path.join(dir, "gossip-seq.eu.json")));
    assert.ok(listSeqShards(cfg).length >= 2);
    assert.equal(nextSeq(cfg, "a", "us"), 2);
    assert.equal(nextSeq(cfg, "a", "eu"), 2);
  });
});
