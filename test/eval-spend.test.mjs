
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { appendEvalHistory } from "../src/eval/history.mjs";
import { summarizeEvalSpend } from "../src/eval/spend.mjs";

describe("eval spend", () => {
  it("sums costUsd from history", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-sp-"));
    const cfg = { paths: { configDir: dir } };
    await appendEvalHistory(cfg, {
      runId: "a",
      passRate: 1,
      passed: 1,
      failed: 0,
      total: 1,
      meanTurns: 1,
      meanWallMs: 100,
      tokens: { total: 1000 },
      cost: { usd: 0.01 },
      results: [{ model: "grok-4.3" }],
    });
    await appendEvalHistory(cfg, {
      runId: "b",
      passRate: 0.5,
      passed: 1,
      failed: 1,
      total: 2,
      meanTurns: 2,
      meanWallMs: 200,
      tokens: { total: 2000 },
      cost: { usd: 0.02 },
      results: [],
    });
    const s = await summarizeEvalSpend(cfg, { limit: 10 });
    assert.equal(s.runs, 2);
    assert.ok(Math.abs(s.totalUsd - 0.03) < 1e-9);
    assert.equal(s.fullyPassedRuns, 1);
  });
});
