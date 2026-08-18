import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordJob } from "../src/jobs/history.mjs";

describe("recordJob always stamps receiptMetrics", () => {
  it("mutates job.receiptMetrics even when omitted", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-srm-"));
    const job = {
      id: "job_stamp_rm",
      goal: "g",
      status: "succeeded",
      pass: true,
      turns: 1,
      toolCalls: 0,
      toolErrors: 0,
      wallMs: 1,
      text: "ok",
      quotaEscalate: { softWarns: 2, hardBlocks: 1, escalatedFromSoft: 1, lastCode: "Q" },
    };
    const { slim } = await recordJob({ paths: { configDir: dir } }, job);
    assert.ok(job.receiptMetrics);
    assert.equal(job.receiptMetrics.quotaEscalate.hardBlocks, 1);
    assert.equal(slim.receiptMetrics.quotaEscalate.softWarns, 2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
