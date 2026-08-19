import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reserveUsd } from "../src/tokens/swarm-ledger.mjs";

describe("swarm job reserve deny payload", () => {
  it("reserve deny has SWARM_LEDGER_HARD_CAP", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-deny-"));
    const cfg = { paths: { configDir: dir }, tokens: { dailyHardUsd: 0.1 } };
    reserveUsd(cfg, { swarmId: "s", childId: "a", usd: 0.08 });
    const deny = reserveUsd(cfg, { swarmId: "s", childId: "b", usd: 0.08 });
    assert.equal(deny.ok, false);
    assert.equal(deny.code, "SWARM_LEDGER_HARD_CAP");
  });
});
