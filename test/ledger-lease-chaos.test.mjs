import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLease, releaseLease } from "../src/tokens/ledger-lease.mjs";

describe("ledger lease chaos", () => {
  it("only one of two concurrent owners wins", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-chaos-"));
    const cfg = { paths: { configDir: dir } };
    const results = [];
    for (const owner of ["gw-1", "gw-2"]) {
      results.push(acquireLease(cfg, { owner, ttlMs: 60_000 }));
    }
    const wins = results.filter((r) => r.ok);
    assert.equal(wins.length, 1);
    const held = results.find((r) => !r.ok);
    assert.ok(held);
    assert.equal(held.reason, "lease_held");
    releaseLease(cfg, { owner: wins[0].owner });
  });
});
