import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLease, releaseLease } from "../src/tokens/ledger-lease.mjs";

describe("ledger primary lease", () => {
  it("acquires and blocks second owner", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-lease-"));
    const cfg = { paths: { configDir: dir } };
    const a = acquireLease(cfg, { owner: "gw-a", ttlMs: 60_000 });
    assert.equal(a.ok, true);
    const b = acquireLease(cfg, { owner: "gw-b", ttlMs: 60_000 });
    assert.equal(b.ok, false);
    assert.equal(b.reason, "lease_held");
    releaseLease(cfg, { owner: "gw-a" });
    const c = acquireLease(cfg, { owner: "gw-b", ttlMs: 60_000 });
    assert.equal(c.ok, true);
  });
});
