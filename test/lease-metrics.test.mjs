import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetLeaseMetrics, getLeaseMetrics } from "../src/tokens/lease-metrics.mjs";
import { acquireLease, releaseLease } from "../src/tokens/ledger-lease.mjs";

describe("lease metrics", () => {
  it("counts acquire and held", () => {
    resetLeaseMetrics();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-met-"));
    const cfg = { paths: { configDir: dir } };
    acquireLease(cfg, { owner: "a", ttlMs: 60_000 });
    acquireLease(cfg, { owner: "b", ttlMs: 60_000 });
    const m = getLeaseMetrics();
    assert.ok(m.lease_acquire_total >= 1);
    assert.ok(m.lease_held_total >= 1);
    releaseLease(cfg, { owner: "a" });
  });
});
