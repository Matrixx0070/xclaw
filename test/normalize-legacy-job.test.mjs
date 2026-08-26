/**
 * Spec §11.6 — normalizeLegacyJob folds old cron JSON field names
 * before absorb. Pins the mapping; absorb uses this before ledger.put.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeLegacyJob } from "../src/cron/durable-jobs.mjs";

describe("normalizeLegacyJob", () => {
  it("maps jobId to id and drops jobId", () => {
    const job = normalizeLegacyJob({ jobId: "alpha", name: "a" });
    assert.equal(job.id, "alpha");
    assert.equal(job.jobId, undefined);
  });

  it("maps a top-level cron string to schedule.kind cron", () => {
    const job = normalizeLegacyJob({ id: "c", cron: "0 * * * *" });
    assert.deepEqual(job.schedule, { kind: "cron", expr: "0 * * * *" });
    assert.equal(job.cron, undefined);
  });

  it("maps schedule.cron string to kind/expr and keeps tz", () => {
    const job = normalizeLegacyJob({
      id: "c",
      schedule: { cron: "0 9 * * *", tz: "UTC" },
    });
    assert.deepEqual(job.schedule, { kind: "cron", expr: "0 9 * * *", tz: "UTC" });
  });

  it("maps intervalMs to schedule.everyMs", () => {
    const job = normalizeLegacyJob({ id: "e", intervalMs: 60_000 });
    assert.deepEqual(job.schedule, { kind: "every", everyMs: 60_000 });
    assert.equal(job.intervalMs, undefined);
  });

  it("maps top-level threadId to delivery when delivery is missing", () => {
    const job = normalizeLegacyJob({ id: "t", threadId: "123" });
    assert.deepEqual(job.delivery, { threadId: "123" });
    assert.equal(job.threadId, undefined);
  });

  it("does not overwrite an existing delivery with threadId", () => {
    const job = normalizeLegacyJob({
      id: "t",
      threadId: "123",
      delivery: { channel: "telegram" },
    });
    assert.deepEqual(job.delivery, { channel: "telegram" });
    assert.equal(job.threadId, undefined);
  });

  it("returns null when there is still no id", () => {
    assert.equal(normalizeLegacyJob({ name: "nope" }), null);
    assert.equal(normalizeLegacyJob(null), null);
    assert.equal(normalizeLegacyJob("x"), null);
  });

  it("keeps a modern job that already has id + schedule", () => {
    const raw = {
      id: "job-alpha",
      enabled: true,
      schedule: { kind: "every", everyMs: 60_000 },
      payload: { kind: "agent", prompt: "ping" },
    };
    const job = normalizeLegacyJob(raw);
    assert.equal(job.id, "job-alpha");
    assert.deepEqual(job.schedule, { kind: "every", everyMs: 60_000 });
    assert.equal(job.payload.prompt, "ping");
  });
});
