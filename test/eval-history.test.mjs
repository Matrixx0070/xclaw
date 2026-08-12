import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { appendEvalHistory, listEvalHistory } from "../src/eval/history.mjs";

describe("eval history", () => {
  it("appends and lists", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-eh-"));
    const cfg = { paths: { configDir: dir } };
    await appendEvalHistory(cfg, {
      runId: "r1",
      passRate: 1,
      passed: 2,
      failed: 0,
      total: 2,
      meanTurns: 1.5,
      meanWallMs: 1000,
      tokens: { total: 100 },
      results: [{ model: "grok-4.3" }],
    });
    const list = await listEvalHistory(cfg, { limit: 5 });
    assert.equal(list.length, 1);
    assert.equal(list[0].passRate, 1);
    assert.equal(list[0].model, "grok-4.3");
  });
});
