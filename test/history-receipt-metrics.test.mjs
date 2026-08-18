import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordJob, listJobs } from "../src/jobs/history.mjs";

describe("history slim receiptMetrics", () => {
  it("persists receiptMetrics on slim and index", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-hist-"));
    const cfg = { paths: { configDir: dir } };
    const { slim } = await recordJob(cfg, {
      id: "job_hist_rm",
      goal: "g",
      status: "succeeded",
      pass: true,
      turns: 1,
      toolCalls: 0,
      toolErrors: 0,
      wallMs: 10,
      text: "ok",
      claimsSoftRetry: { max: 2, used: 1, remaining: 1, attempts: [{}] },
      quotaEscalate: { softWarns: 1, hardBlocks: 0, escalatedFromSoft: 0, lastCode: "SOFT" },
    });
    assert.ok(slim.receiptMetrics);
    assert.equal(slim.receiptMetrics.claimsSoftRetry.used, 1);
    assert.equal(slim.quotaEscalate.softWarns, 1);
    const listed = await listJobs(cfg, { limit: 5 });
    assert.ok(listed.some((j) => j.id === "job_hist_rm" && j.receiptMetrics));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
