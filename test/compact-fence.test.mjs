import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bumpFence, acceptFence, readFence } from "../src/cluster/compact-fence.mjs";
import { compactSeqLedger } from "../src/cluster/gossip-seq.mjs";
import { acquireCompactLease } from "../src/cluster/compact-lease.mjs";

describe("compact fence", () => {
  it("old fence cannot compact", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cf-"));
    const cfg = { paths: { configDir: dir } };
    const a = bumpFence(cfg, "us", { owner: "a" });
    bumpFence(cfg, "us", { owner: "b" });
    const stale = acceptFence(cfg, "us", a.fence);
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "STALE_FENCE");
    const r = compactSeqLedger({ ...cfg, _seqRegion: "us", compactFence: a.fence });
    assert.equal(r.ok, false);
  });
  it("acquire returns fence", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cf2-"));
    const cfg = { paths: { configDir: dir } };
    const l = acquireCompactLease(cfg, "eu", { owner: "gw-a" });
    assert.ok(l.fence >= 1);
    assert.ok(readFence(cfg, "eu").fence >= 1);
  });
});
