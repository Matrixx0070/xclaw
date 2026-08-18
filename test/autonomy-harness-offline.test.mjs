/**
 * Offline autonomy harness — no API key, no computer.
 * Validates case load, graders, and autonomy metrics pipeline.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadCases, EVAL_ROOT } from "../src/eval/runner.mjs";
import { scoreCase } from "../src/eval/scorer.mjs";
import {
  scoreAutonomyRun,
  aggregateAutonomy,
} from "../src/eval/autonomy-metrics.mjs";

describe("autonomy harness offline", () => {
  it("loads autonomy-tagged cases", async () => {
    const cases = await loadCases({ tag: "autonomy" });
    assert.ok(cases.length >= 8, `expected >=8 autonomy cases, got ${cases.length}`);
    const ids = new Set(cases.map((c) => c.id));
    assert.ok(ids.has("a4-G01-write-read"));
    assert.ok(ids.has("a4-G02-multi-step"));
  });

  it("scores synthetic pass for a4-G01 file_contains", async () => {
    const cases = await loadCases({ id: "a4-G01-write-read" });
    assert.equal(cases.length, 1);
    const caseDef = cases[0];
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-a4-off-"));
    await fs.writeFile(path.join(workspace, "a4-hello.txt"), "autonomy-ok\n");
    const jobLike = {
      text: "Wrote and verified a4-hello.txt",
      turns: 2,
      toolTrace: [
        { name: "xclaw_file_write", status: "ok" },
        { name: "xclaw_file_read", status: "ok" },
      ],
      toolCalls: 2,
      toolErrors: 0,
      wallMs: 100,
      status: "succeeded",
      workspace,
    };
    const scored = await scoreCase(caseDef, jobLike);
    assert.equal(scored.pass, true, JSON.stringify(scored.checks || scored));
    const auto = scoreAutonomyRun(jobLike, scored);
    assert.equal(auto.completion, true);
    assert.equal(auto.toolFirst, true);
    assert.equal(auto.zeroToolHandoff, false);
  });

  it("scores fail when expected file missing", async () => {
    const cases = await loadCases({ id: "a4-G01-write-read" });
    const caseDef = cases[0];
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-a4-off-"));
    const jobLike = {
      text: "I could not complete the task.",
      turns: 1,
      toolTrace: [],
      toolCalls: 0,
      toolErrors: 0,
      wallMs: 10,
      status: "failed",
      workspace,
    };
    const scored = await scoreCase(caseDef, jobLike);
    assert.equal(scored.pass, false);
    const auto = scoreAutonomyRun(jobLike, scored);
    assert.equal(auto.completion, false);
  });

  it("flags zero-tool handoff on autonomy metric", () => {
    const auto = scoreAutonomyRun({
      text: "Please provide the API endpoint so I can continue.",
      toolTrace: [],
    });
    assert.equal(auto.zeroToolHandoff, true);
    assert.equal(auto.toolFirst, false);
  });

  it("aggregates a mini campaign", async () => {
    const cases = await loadCases({ tag: "autonomy" });
    const sample = cases.slice(0, 5);
    const rows = [];
    for (const caseDef of sample) {
      const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-a4-agg-"));
      const jobLike = {
        text: "done",
        turns: 1,
        toolTrace: [{ name: "xclaw_bash", status: "ok" }],
        workspace,
      };
      const scored = await scoreCase(caseDef, jobLike);
      rows.push(scoreAutonomyRun(jobLike, scored));
    }
    const agg = aggregateAutonomy(rows);
    assert.equal(agg.n, 5);
    assert.ok(agg.toolFirstRate >= 0 && agg.toolFirstRate <= 1);
    assert.ok(typeof agg.meanToolCount === "number");
  });

  it("EVAL_ROOT has fixtures dir", async () => {
    const fix = path.join(EVAL_ROOT, "fixtures");
    const st = await fs.stat(fix);
    assert.ok(st.isDirectory());
  });
});
