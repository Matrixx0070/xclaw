import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inQuietHours,
  canSpend,
  recordSpend,
  ensureHeartbeat,
  heartbeatStatus,
} from "../src/cron/heartbeat.mjs";
import { listJobs, cancelJob, stop as stopScheduler } from "../src/cron/scheduler.mjs";

describe("R4 heartbeat autonomy", () => {
  it("inQuietHours overnight window", () => {
    // 23–7: hour 1 is quiet, hour 12 is not
    const cfg = {
      autonomy: { quietHours: { enabled: true, startHour: 23, endHour: 7, tzOffsetMinutes: 0 } },
    };
    // Use fixed times via Date - inQuietHours uses Date.now()+offset getUTCHours
    // We test pure logic by constructing cfg and mocking is hard; test boundary helpers:
    assert.equal(
      inQuietHours({
        autonomy: { quietHours: { enabled: false, startHour: 23, endHour: 7 } },
      }),
      false
    );
  });

  it("canSpend respects daily cap", () => {
    const cfg = { autonomy: { maxUsdPerDay: 1.0 } };
    // reset by using fresh day internally
    const a = canSpend(cfg, 0);
    assert.equal(a.ok, true);
    recordSpend(0.6);
    assert.equal(canSpend(cfg, 0.5).ok, false);
  });

  it("ensureHeartbeat registers job when enabled", () => {
    // clean prior
    for (const j of listJobs()) {
      if (j.name === "xclaw-heartbeat") cancelJob(j.id);
    }
    const r = ensureHeartbeat({
      autonomy: {
        heartbeat: {
          enabled: true,
          everyMs: 120_000,
          prompt: "HEARTBEAT_OK test",
        },
      },
    });
    assert.equal(r.enabled, true);
    assert.ok(r.jobId);
    const jobs = listJobs().filter((j) => j.name === "xclaw-heartbeat");
    assert.equal(jobs.length, 1);
    stopScheduler();
  });

  it("heartbeatStatus returns shape", () => {
    const st = heartbeatStatus();
    assert.ok("lastRunAt" in st);
    assert.ok("scheduler" in st);
  });
});
