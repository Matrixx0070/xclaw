import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cron-"));
const storeFile = path.join(tmpDir, "cron-jobs.json");
process.env.XCLAW_CRON_JOBS_FILE = storeFile;

// Import AFTER the env override so every persist/restore hits the temp store.
const sched = await import("../src/cron/scheduler.mjs");

function clearAll() {
  for (const j of sched.listJobs()) sched.cancelJob(j.id);
}

describe("cron scheduler persistence (R16)", () => {
  before(clearAll);
  after(() => {
    clearAll();
    sched.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.XCLAW_CRON_JOBS_FILE;
  });

  it("payload jobs persist to disk on add", () => {
    clearAll();
    const job = sched.addJob({
      name: "nightly-report",
      schedule: { kind: "cron", expr: "0 3 * * *" },
      payload: { kind: "agentTurn", prompt: "write the nightly report" },
    });
    assert.ok(fs.existsSync(storeFile), "store file written");
    const raw = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    const rec = raw.jobs.find((j) => j.id === job.id);
    assert.ok(rec, "job record persisted");
    assert.equal(rec.payload.prompt, "write the nightly report");
    assert.ok(!("handler" in rec) && !("_cfg" in rec), "no unserializable fields");
  });

  it("handler-backed jobs are NOT persisted (process-owned)", () => {
    clearAll();
    sched.addJob({
      name: "heartbeat-like",
      schedule: { kind: "every", everyMs: 60_000 },
      handler: async () => {},
    });
    const raw = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    assert.equal(raw.jobs.filter((j) => j.name === "heartbeat-like").length, 0);
  });

  it("restore survives a simulated restart (re-arms with fresh nextRunAt)", () => {
    clearAll();
    const job = sched.addJob({
      name: "weekly",
      schedule: { kind: "cron", expr: "0 0 * * 1" },
      payload: { kind: "agentTurn", prompt: "weekly digest" },
    });
    // Simulated restart: drop in-memory state without touching the store file,
    // then restore through start(). cancelJob would rewrite the store, so this
    // reaches into nothing — it re-reads the persisted file only.
    const persisted = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    clearAll(); // in-memory gone; store now empty too…
    fs.writeFileSync(storeFile, JSON.stringify(persisted, null, 2)); // …restore file
    assert.equal(sched.listJobs().length, 0, "memory is empty pre-restore");

    const out = sched.start();
    assert.equal(out.restored, 1);
    const back = sched.getJob(job.id);
    assert.ok(back, "job re-registered under the same id");
    assert.equal(back.name, "weekly");
    assert.ok(back.nextRunAt > Date.now(), "re-armed in the future");
    assert.equal(new Date(back.nextRunAt).getDay(), 1, "cron semantics preserved");
    sched.stop();
  });

  it("restore is idempotent (existing ids skipped)", () => {
    const before = sched.listJobs().length;
    const out = sched.restorePersistedJobs();
    assert.equal(out.restored, 0);
    assert.equal(sched.listJobs().length, before);
  });

  it("cancel removes the job from the store", () => {
    for (const j of sched.listJobs()) sched.cancelJob(j.id);
    const raw = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    assert.equal(raw.jobs.length, 0);
  });

  it("corrupt store restores to empty without throwing", () => {
    fs.writeFileSync(storeFile, "{not json");
    const out = sched.restorePersistedJobs();
    assert.equal(out.ok, false);
    assert.equal(out.restored, 0);
  });

  it("missing store is a clean no-op", () => {
    fs.rmSync(storeFile, { force: true });
    const out = sched.restorePersistedJobs();
    assert.deepEqual(out, { ok: true, restored: 0 });
  });
});
