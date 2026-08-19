import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reserveUsd } from "../src/tokens/swarm-ledger.mjs";
import { acquireLease } from "../src/tokens/ledger-lease.mjs";

describe("reserve requires lease when enabled", () => {
  it("denies reserve when other owner holds lease", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ll-"));
    const cfg = {
      paths: { configDir: dir },
      tokens: { ledgerLease: true, dailyHardUsd: 10 },
    };
    acquireLease(cfg, { owner: "primary", ttlMs: 60_000 });
    const res = reserveUsd(cfg, { swarmId: "s", childId: "c", usd: 0.1, leaseOwner: "secondary" });
    assert.equal(res.ok, false);
    assert.equal(res.code, "SWARM_LEDGER_LEASE_HELD");
  });
});
