import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordJob } from "../src/jobs/history.mjs";
import { pushReceiptMetricsChecks } from "../src/cli/doctor-receipt-metrics.mjs";

describe("doctor ops.receipt_metrics", () => {
  it("warns when no jobs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-drm-"));
    const checks = [];
    await pushReceiptMetricsChecks((id, status, message) => checks.push({ id, status, message }), {
      paths: { configDir: dir },
    });
    assert.equal(checks[0].id, "ops.receipt_metrics");
    assert.equal(checks[0].status, "warn");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ok when history has receiptMetrics", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-drm2-"));
    const cfg = { paths: { configDir: dir } };
    await recordJob(cfg, {
      id: "job_drm",
      goal: "g",
      status: "succeeded",
      pass: true,
      turns: 1,
      toolCalls: 0,
      toolErrors: 0,
      wallMs: 5,
      text: "ok",
      claimsSoftRetry: { max: 1, used: 0, remaining: 1 },
      quotaEscalate: { softWarns: 0, hardBlocks: 0, escalatedFromSoft: 0 },
    });
    const checks = [];
    await pushReceiptMetricsChecks((id, status, message, extra) => checks.push({ extra, status }), cfg);
    assert.equal(checks[0].status, "ok");
    assert.equal(checks[0].extra.withMetrics, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
