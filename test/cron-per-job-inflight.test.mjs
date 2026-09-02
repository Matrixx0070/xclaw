/**
 * Tick must not serialize unrelated due jobs behind one process flag.
 *
 * Live 2026-09-02 pid 2798540 (version 3.562.0): eval-suite started 11:11:49
 * and was still in-flight at 13:30:14Z. Digest (due 11:14:35) and doctor
 * (due 12:04:32) sat overdue because tick awaited each handler under
 * `let running = false` / `if (running) return`. Doctor reported
 * `3 enabled / 3 total` ok. Same-id overlap is still rejected.
 * Stamp-on-attempt, no-catch-up, and first-arm-wins stay.
 * Do not reopen 3.283.0–3.286.0 / 3.312.0 (jobs ARE armed; one handler
 * blocked siblings). Homedir JSON store-writer class remains EXHAUSTED
 * at 3.560.0.
 */
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  addJob,
  cancelJob,
  run,
  updateJob,
  status,
} from "../src/cron/scheduler.mjs";

const ROOT = path.dirname(fileURLToPath(new URL(".", import.meta.url)));

const added = [];
function register(input) {
  const job = addJob({
    enabled: true,
    schedule: { kind: "every", everyMs: 86_400_000 },
    handler: async () => {},
    ...input,
  });
  added.push(job.id);
  return job;
}

afterEach(() => {
  while (added.length) cancelJob(added.pop());
});

async function waitFor(pred, timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    if (await pred()) return;
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 25));
  }
}

function schedulerSrc() {
  return readFileSync(path.join(ROOT, "src/cron/scheduler.mjs"), "utf8");
}

function tickSlice() {
  const src = schedulerSrc();
  const start = src.indexOf("async function tick()");
  const end = src.indexOf("async function runJob(");
  assert.ok(start >= 0 && end > start, "tick slice not found");
  return src.slice(start, end);
}

function runJobSlice() {
  const src = schedulerSrc();
  const start = src.indexOf("async function runJob(");
  const end = src.indexOf("export function addJob");
  assert.ok(start >= 0 && end > start, "runJob slice not found");
  return src.slice(start, end);
}

function serializeSlice() {
  const src = schedulerSrc();
  const start = src.indexOf("function serializeJob(");
  const end = src.indexOf("function persistJobs(");
  assert.ok(start >= 0 && end > start, "serializeJob slice not found");
  return src.slice(start, end);
}

function doctorCronSlice() {
  const src = readFileSync(path.join(ROOT, "src/gateway/doctor.mjs"), "utf8");
  const start = src.indexOf("  // cron");
  const end = src.indexOf("  // skills");
  assert.ok(start >= 0 && end > start, "doctor cron slice not found");
  return src.slice(start, end);
}

describe("cron tick is per-job in-flight", () => {
  test("scheduler has no process-global running flag", () => {
    const src = schedulerSrc();
    assert.doesNotMatch(src, /let running = false/);
    assert.doesNotMatch(tickSlice(), /if \(running\) return/);
  });

  test("tick starts due jobs without awaiting the previous handler", () => {
    const slice = tickSlice();
    assert.match(slice, /if \(job\.running\) continue/);
    assert.match(slice, /void runJob\(job/);
    assert.doesNotMatch(slice, /await runJob\(/);
  });

  test("runJob rejects same-id overlap and run() surfaces already_running", () => {
    const slice = runJobSlice();
    assert.match(slice, /if \(job\.running\) return false/);
    const src = schedulerSrc();
    assert.match(src, /error: "already_running"/);
  });

  test("serializeJob does not persist running", () => {
    const slice = serializeSlice();
    assert.match(slice, /running/);
    assert.match(slice, /handler, _cfg, _lastAnnounce, running/);
  });

  test("doctor cron check warns on overdue or in-flight, does not flip ok", () => {
    const slice = doctorCronSlice();
    assert.match(slice, /listJobs\(\{ includeDisabled: false \}\)/);
    assert.match(slice, /severity: "warn"/);
    assert.match(slice, /push\("cron", true/);
    assert.match(slice, /overdue/);
    assert.match(slice, /in-flight/);
  });

  test("Control Automations paints in-flight and overdue", () => {
    const src = readFileSync(path.join(ROOT, "ui/control/app.js"), "utf8");
    const start = src.indexOf("async function loadAutomations()");
    const end = src.indexOf("tbody.querySelectorAll(\".auto-run\")");
    assert.ok(start >= 0 && end > start, "loadAutomations slice not found");
    const slice = src.slice(start, end);
    assert.match(slice, /in flight/);
    assert.match(slice, /overdue/);
    assert.match(slice, /j\.running/);
  });

  test("a long job does not block a sibling due job", async () => {
    let releaseSlow;
    const slowGate = new Promise((r) => (releaseSlow = r));
    let fastRan = false;
    const slow = register({
      name: "slow-eval",
      handler: async () => {
        await slowGate;
      },
    });
    const fast = register({
      name: "fast-digest",
      handler: async () => {
        fastRan = true;
      },
    });
    const slowRun = run(slow.id);
    await waitFor(() => slow.running === true);
    assert.equal(slow.lastStatus, null, "lastStatus stays null while in-flight");
    const fastResult = await run(fast.id);
    assert.equal(fastResult.ok, true);
    assert.equal(fastRan, true);
    assert.equal(fast.lastStatus, "ok");
    assert.equal(slow.running, true);
    assert.equal(slow.lastStatus, null);
    releaseSlow();
    const slowResult = await slowRun;
    assert.equal(slowResult.ok, true);
    assert.equal(slow.lastStatus, "ok");
    assert.equal(slow.running, false);
  });

  test("same-id concurrent run is rejected", async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const job = register({
      name: "once",
      handler: async () => {
        await gate;
      },
    });
    const first = run(job.id);
    await waitFor(() => job.running === true);
    const second = await run(job.id);
    assert.equal(second.ok, false);
    assert.equal(second.error, "already_running");
    release();
    const firstResult = await first;
    assert.equal(firstResult.ok, true);
    assert.equal(job.lastStatus, "ok");
  });

  test("tick fires a due sibling while another job is in-flight", async () => {
    let releaseSlow;
    const slowGate = new Promise((r) => (releaseSlow = r));
    let fastTicks = 0;
    const slow = register({
      name: "tick-slow",
      handler: async () => {
        await slowGate;
      },
    });
    const fast = register({
      name: "tick-fast",
      handler: async () => {
        fastTicks += 1;
      },
    });
    const slowRun = run(slow.id);
    await waitFor(() => slow.running === true);
    slow.nextRunAt = Date.now() + 86_400_000;
    fast.nextRunAt = Date.now() - 1000;
    updateJob(fast.id, {});
    await waitFor(() => fastTicks >= 1);
    assert.equal(slow.running, true, "slow still in-flight when sibling ticked");
    assert.equal(slow.lastStatus, null);
    releaseSlow();
    await slowRun;
    const st = status();
    assert.equal(typeof st.inFlight, "number");
    assert.equal(st.inFlight, 0);
  });
});
