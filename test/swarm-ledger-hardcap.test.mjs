import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reserveUsd } from "../src/tokens/swarm-ledger.mjs";

describe("swarm ledger hard cap", () => {
  it("rejects reserve over daily hard", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-hc-"));
    const cfg = { paths: { configDir: dir }, tokens: { dailyHardUsd: 1 } };
    const ok = reserveUsd(cfg, { swarmId: "s", childId: "c", usd: 0.5 });
    assert.equal(ok.ok, true);
    const deny = reserveUsd(cfg, { swarmId: "s", childId: "c2", usd: 1 });
    assert.equal(deny.ok, false);
    assert.equal(deny.code, "SWARM_LEDGER_HARD_CAP");
  });
});
