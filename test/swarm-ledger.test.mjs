import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reserveUsd, settleUsd, ledgerSnapshot } from "../src/tokens/swarm-ledger.mjs";

describe("swarm cost ledger", () => {
  it("reserves and settles", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-led-"));
    const cfg = { paths: { configDir: dir } };
    reserveUsd(cfg, { swarmId: "s1", childId: "c1", usd: 1 });
    let snap = ledgerSnapshot(cfg);
    assert.ok(snap.reservedUsd >= 1);
    settleUsd(cfg, { swarmId: "s1", childId: "c1", usd: 0.5 });
    snap = ledgerSnapshot(cfg);
    assert.ok(snap.spentUsd >= 0.5);
  });
});
