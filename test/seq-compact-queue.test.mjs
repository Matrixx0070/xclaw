import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acceptSeq } from "../src/cluster/gossip-seq.mjs";
import {
  enqueueCompact,
  compactQueueDepth,
  drainCompactQueue,
  resetCompactQueue,
} from "../src/cluster/seq-compact-queue.mjs";

describe("async compact queue", () => {
  it("coalesces region and drain compacts", () => {
    resetCompactQueue();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cq-"));
    const cfg = { paths: { configDir: dir }, cluster: { seqGcMax: 2, seqHotMs: 60_000 } };
    acceptSeq(cfg, { owner: "a", seq: 1, region: "us" });
    enqueueCompact("us");
    enqueueCompact("us");
    assert.equal(compactQueueDepth(), 1);
    const r = drainCompactQueue(cfg);
    assert.equal(r.ok, true);
    assert.equal(r.drained, 1);
    assert.equal(compactQueueDepth(), 0);
  });
});
