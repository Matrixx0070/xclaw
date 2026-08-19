import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetLeaseMetrics, getLeaseMetrics } from "../src/tokens/lease-metrics.mjs";
import { acquireLease, releaseLease } from "../src/tokens/ledger-lease.mjs";

describe("lease metrics chaos", () => {
  it("increments under concurrent acquires", () => {
    resetLeaseMetrics();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-mc-"));
    const cfg = { paths: { configDir: dir } };
    const results = [];
    for (let i = 0; i < 8; i++) {
      results.push(acquireLease(cfg, { owner: `gw-${i}`, ttlMs: 60_000 }));
    }
    const wins = results.filter((r) => r.ok);
    assert.equal(wins.length, 1);
    const m = getLeaseMetrics();
    assert.ok(m.lease_acquire_total >= 1);
    assert.ok(m.lease_held_total >= 1);
    releaseLease(cfg, { owner: wins[0].owner });
  });
});
