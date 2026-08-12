
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  appendSoakRun,
  appendFlake,
  getSoakSummary,
} from "../src/eval/soak.mjs";

describe("soak ledger", () => {
  it("records runs and flakes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-soak-"));
    const cfg = { paths: { configDir: dir } };
    await appendSoakRun(cfg, { tags: ["smoke"], passed: 2, failed: 0, total: 2, passRate: 1 });
    await appendFlake(cfg, { caseId: "x", tag: "smoke" });
    const s = await getSoakSummary(cfg);
    assert.equal(s.runs, 1);
    assert.equal(s.flakes, 1);
    assert.ok(s.gate);
  });
});
