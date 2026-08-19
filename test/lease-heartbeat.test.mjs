import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLease, renewLease, readLease } from "../src/tokens/ledger-lease.mjs";

describe("lease heartbeat renew", () => {
  it("extends expiresAt", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-hb-"));
    const cfg = { paths: { configDir: dir } };
    const a = acquireLease(cfg, { owner: "hb", ttlMs: 5_000 });
    assert.equal(a.ok, true);
    const before = a.expiresAt;
    await new Promise((r) => setTimeout(r, 20));
    const r = renewLease(cfg, { owner: "hb", ttlMs: 60_000 });
    assert.equal(r.ok, true);
    assert.ok(r.expiresAt > before);
    const cur = readLease(cfg);
    assert.equal(cur.owner, "hb");
  });
});
