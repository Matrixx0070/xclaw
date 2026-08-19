import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireCompactLease, releaseCompactLease } from "../src/cluster/compact-lease.mjs";
import {
  drainCompactQueue,
  enqueueCompact,
  resetCompactQueue,
} from "../src/cluster/seq-compact-queue.mjs";

describe("compact lease", () => {
  it("second acquire fails while held", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cl-"));
    const cfg = { paths: { configDir: dir }, cluster: { compactLeaseTtlMs: 15_000 } };
    const a = acquireCompactLease(cfg, "us", { owner: "gw-a" });
    assert.equal(a.ok, true);
    const b = acquireCompactLease(cfg, "us", { owner: "gw-b" });
    assert.equal(b.ok, false);
    assert.equal(b.code, "LEASE_HELD");
    releaseCompactLease(cfg, "us", { owner: "gw-a" });
    const c = acquireCompactLease(cfg, "us", { owner: "gw-b" });
    assert.equal(c.ok, true);
  });
  it("drain skips when leased", () => {
    resetCompactQueue();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cl2-"));
    const cfg = { paths: { configDir: dir } };
    acquireCompactLease(cfg, "eu", { owner: "other" });
    enqueueCompact("eu");
    const r = drainCompactQueue(cfg);
    assert.equal(r.results[0].skipped, true);
  });
});
