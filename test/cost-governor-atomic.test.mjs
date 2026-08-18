/**
 * Concurrent recordJobCost must not drop increments under file lock.
 * Applies cost-governor-atomic.patch if markers are missing.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("cost governor atomic ledger", () => {
  let tmp;
  let cfg;
  let recordJobCost;
  let getCostGovernorStatus;

  before(async () => {
    spawnSync(process.execPath, [path.join(root, "scripts/apply-ship-patches.mjs")], {
      cwd: root,
      encoding: "utf8",
    });
    ({ recordJobCost, getCostGovernorStatus } = await import(
      "../src/tokens/cost-governor.mjs"
    ));
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-cost-atomic-"));
    cfg = {
      paths: { configDir: tmp },
      cost: { dailySoftUsd: 50, dailyHardUsd: 100, pauseQueueOnHard: false },
    };
    await fs.writeFile(
      path.join(tmp, "cost-governor.json"),
      JSON.stringify({
        day: new Date().toISOString().slice(0, 10),
        spentUsd: 0,
        jobs: 0,
        paused: false,
        events: [],
      })
    );
  });

  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("module exposes locked recordJobCost", async () => {
    const src = await fs.readFile(
      path.join(root, "src/tokens/cost-governor.mjs"),
      "utf8"
    );
    assert.match(src, /withLedgerLock/);
    assert.match(src, /recordJobCostUnlocked/);
  });

  it("N parallel 0.01 records sum to ~N*0.01", async () => {
    const N = 20;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        recordJobCost(cfg, { usd: 0.01, jobId: `atomic-${i}` })
      )
    );
    const st = await getCostGovernorStatus(cfg);
    const expected = Math.round(N * 0.01 * 1e6) / 1e6;
    assert.ok(
      Math.abs(st.spentUsd - expected) < 0.0001,
      `expected ${expected}, got ${st.spentUsd}`
    );
    assert.equal(st.jobs, N);
  });
});
