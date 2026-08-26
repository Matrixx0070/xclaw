import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cron-"));
const jsonFile = path.join(tmpDir, "cron-jobs.json");
const ledgerFile = path.join(tmpDir, "cron", "jobs.sqlite");
process.env.XCLAW_CRON_JOBS_FILE = jsonFile;
process.env.XCLAW_CRON_LEDGER_FILE = ledgerFile;

const sched = await import("../src/cron/scheduler.mjs");

test("payload jobs survive stop/start through the ledger", async () => {
  fs.writeFileSync(
    jsonFile,
    JSON.stringify({
      version: 1,
      jobs: [
        {
          id: "job-alpha",
          enabled: true,
          schedule: { kind: "every", everyMs: 60_000 },
          payload: { kind: "agent", prompt: "ping" },
        },
      ],
    }) + "\n",
  );

  const first = sched.start({});
  assert.equal(first.ok, true);
  assert.ok(first.restored >= 1);
  assert.equal(fs.existsSync(ledgerFile), true);
  sched.stop();

  // JSON should have been renamed after a successful absorb.
  assert.equal(fs.existsSync(jsonFile), false);

  const second = sched.start({});
  assert.ok(second.restored >= 1);
  const listed = sched.listJobs();
  assert.ok(listed.some((j) => j.id === "job-alpha"));
  sched.stop();
});
