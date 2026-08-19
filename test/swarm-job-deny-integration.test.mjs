import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reserveUsd } from "../src/tokens/swarm-ledger.mjs";

function denyFromReserve(res, opts = {}) {
  if (res.ok !== false) return null;
  return {
    id: opts.id || "job_denied",
    goal: opts.goal || "test",
    status: "failed",
    pass: false,
    error: res.message || "swarm ledger hard cap",
    code: res.code || "SWARM_LEDGER_HARD_CAP",
    costBlocked: true,
    swarmId: opts.swarmId || null,
  };
}

describe("swarm job deny integration", () => {
  it("builds full deny payload from reserve failure", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-int-"));
    const cfg = { paths: { configDir: dir }, tokens: { dailyHardUsd: 0.05 } };
    reserveUsd(cfg, { swarmId: "s", childId: "a", usd: 0.04 });
    const res = reserveUsd(cfg, { swarmId: "s", childId: "b", usd: 0.04 });
    const job = denyFromReserve(res, { swarmId: "s", goal: "child-b" });
    assert.ok(job);
    assert.equal(job.costBlocked, true);
    assert.equal(job.code, "SWARM_LEDGER_HARD_CAP");
    assert.equal(job.status, "failed");
    assert.equal(job.pass, false);
  });
});
