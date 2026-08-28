/**
 * Maintenance crons must schedule against a durable stamp, not process uptime.
 *
 * A {kind:"every"} schedule is relative: every boot recomputes nextRunAt from
 * now, so a job whose interval exceeds the gateway's uptime never reaches its
 * first run — silently, because a job that does not run logs nothing. Measured
 * on the live host (2026-08-28): the daily eval suite was registered at all 339
 * boots in the log and started 6 times in 13 days, last completing 2026-08-17,
 * against a median inter-boot gap of 24 minutes.
 *
 * These pin the anchored path, the deliberate NON-catch-up of payload jobs it
 * must not disturb, and the due.mjs primitives the ops job also rides on.
 */
import assert from "node:assert/strict";
import { describe, it, afterEach, mock } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  markRan,
  markArmed,
  readDueState,
  readDueStateSync,
  readAnchorsSync,
  dueStatePath,
  dueJobStatus,
  startPeriodic,
} from "../src/ops/due.mjs";
import { addJob, cancelJob, run } from "../src/cron/scheduler.mjs";

const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;
const KEY = "cron.evalSuite";

const added = [];
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cronanchor-"));
  return {
    dir,
    cfg: { paths: { configDir: dir } },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** Registers through the real scheduler; every job is torn down after. */
function register(input) {
  const job = addJob({ enabled: true, handler: async () => {}, ...input });
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

describe("interval cron jobs survive restarts", () => {
  it("THE REGRESSION: a restart resumes the schedule instead of restarting it", async () => {
    const f = fixture();
    try {
      // A boot 23 hours after the last daily run. The unanchored job re-arms a
      // full day out and the host is gone long before then — repeat forever and
      // the job never runs at all.
      const t0 = Date.now();
      await markRan(f.cfg, KEY, t0 - 23 * HOUR);

      const anchored = register({
        name: "anchored",
        schedule: { kind: "every", everyMs: DAY },
        cfg: f.cfg,
        anchorKey: KEY,
      });
      const drift = anchored.nextRunAt - (t0 + HOUR);
      assert.ok(
        Math.abs(drift) < 60_000,
        `anchored job must run ~1h from now (the interval's remainder), got ${drift}ms off`
      );

      const bare = register({
        name: "bare",
        schedule: { kind: "every", everyMs: DAY },
        cfg: f.cfg,
      });
      assert.ok(
        bare.nextRunAt - t0 > 23 * HOUR,
        "without an anchor the boot resets the clock — this is the defect"
      );
    } finally {
      f.cleanup();
    }
  });

  it("an overdue anchored job runs shortly after boot, not an interval later", async () => {
    const f = fixture();
    try {
      const t0 = Date.now();
      await markRan(f.cfg, KEY, t0 - 6 * DAY);
      const job = register({
        schedule: { kind: "every", everyMs: DAY },
        cfg: f.cfg,
        anchorKey: KEY,
      });
      const delay = job.nextRunAt - t0;
      assert.ok(delay > 0, "not immediate — a catch-up must not run during boot");
      assert.ok(delay <= 61_000, `overdue catch-up must land just after boot, got ${delay}ms`);
    } finally {
      f.cleanup();
    }
  });

  it("a never-run anchored job waits a full interval, but arms durably", async () => {
    const f = fixture();
    try {
      // A fresh install must not launch an hour-long suite while it is still
      // booting, so the first run stays an interval out — but the clock it
      // counts on is written down rather than held in process memory.
      const t0 = Date.now();
      const job = register({
        schedule: { kind: "every", everyMs: DAY },
        cfg: f.cfg,
        anchorKey: KEY,
      });
      assert.ok(job.nextRunAt - t0 > 23 * HOUR, "first run stays a full interval out");
      await waitFor(() => Number.isFinite(readAnchorsSync(f.cfg).armed[KEY]));
      assert.equal(readAnchorsSync(f.cfg).lastRun[KEY], undefined, "armed is not a run");
    } finally {
      f.cleanup();
    }
  });

  it("THE SECOND REGRESSION: a job whose interval exceeds uptime still converges", async () => {
    const f = fixture();
    try {
      // Anchoring to the last run resumes a schedule but cannot begin one:
      // with no stamp at all, every boot recomputes the same distant first run
      // and a host that restarts more often than the interval never reaches
      // it. Measured live at 3.285.0: of the three anchored maintenance crons
      // only the 5-minute digest had ever stamped — the hourly doctor and the
      // daily eval suite had not, against a 24-minute median uptime.
      const t0 = Date.now();
      const first = register({ schedule: { kind: "every", everyMs: DAY }, cfg: f.cfg, anchorKey: KEY });
      await waitFor(() => Number.isFinite(readAnchorsSync(f.cfg).armed[KEY]));
      const armedAt = readAnchorsSync(f.cfg).armed[KEY];

      // Ten restarts, an hour of simulated time apart. The spacing is the
      // whole point: boots inside one millisecond compute a target that is
      // indistinguishable from the anchored one, so the receding-target bug is
      // invisible without a clock that moves. Only Date is mocked — the write
      // chain below still settles on real promises — and mocking starts here,
      // after the wait above, so a frozen clock can never stall waitFor.
      mock.timers.enable({ apis: ["Date"], now: armedAt });
      let job = first;
      for (let i = 1; i <= 10; i++) {
        mock.timers.setTime(armedAt + i * HOUR);
        cancelJob(added.pop());
        job = register({ schedule: { kind: "every", everyMs: DAY }, cfg: f.cfg, anchorKey: KEY });
      }
      // The scheduler arms fire-and-forget, so settle the shared write chain
      // before reading — otherwise a re-arm that IS happening has simply not
      // landed yet and the assertion passes for the wrong reason.
      await markArmed(f.cfg, "drain.probe", Date.now());
      assert.equal(readAnchorsSync(f.cfg).armed[KEY], armedAt, "first arm wins; boots do not re-arm");
      const drift = job.nextRunAt - (armedAt + DAY);
      assert.ok(
        Math.abs(drift) < 60_000,
        `after 10 restarts the first run must still be ~1 interval from the ARM, got ${drift}ms off`
      );
      // Ten hours of boots later the target has not receded ten hours with
      // them. The tolerance is the arm-write latency, not slack: measured from
      // the newest boot instead of the arm this overshoots by HOURS.
      const recede = job.nextRunAt - t0 - DAY;
      assert.ok(
        recede <= 60_000,
        `the target never moves further away with each boot; receded ${Math.round(recede / 60_000)}min`
      );
    } finally {
      mock.timers.reset();
      f.cleanup();
    }
  });

  it("arming twice keeps the first arm, so a boot cannot restart the clock", async () => {
    const f = fixture();
    try {
      // The scheduler only calls markArmed when no epoch exists, so this
      // invariant lives at the primitive: two registrations racing before the
      // first write lands both reach here, and a later arm overwriting an
      // earlier one is precisely the reset-at-every-boot bug.
      const t0 = 1_700_000_000_000;
      assert.equal(await markArmed(f.cfg, KEY, t0), true, "first arm is written");
      assert.equal(await markArmed(f.cfg, KEY, t0 + HOUR), false, "second arm is refused");
      assert.equal(readAnchorsSync(f.cfg).armed[KEY], t0, "the clock still counts from the first");
    } finally {
      f.cleanup();
    }
  });

  it("a run stamp outranks the arm stamp once the job has actually run", async () => {
    const f = fixture();
    try {
      const t0 = Date.now();
      await markArmed(f.cfg, KEY, t0 - 10 * DAY); // armed long ago
      await markRan(f.cfg, KEY, t0 - 23 * HOUR); // but ran an hour ago-ish
      const job = register({ schedule: { kind: "every", everyMs: DAY }, cfg: f.cfg, anchorKey: KEY });
      const drift = job.nextRunAt - (t0 + HOUR);
      assert.ok(Math.abs(drift) < 60_000, `must count from the run, not the arm; ${drift}ms off`);
    } finally {
      f.cleanup();
    }
  });

  it("the two stamps survive each other's writes", async () => {
    const f = fixture();
    try {
      // Each writer rewrites the whole file. Dropping `armed` here would
      // silently re-arm every job at the next boot and reset the clocks.
      const t0 = 1_700_000_000_000;
      await markArmed(f.cfg, KEY, t0);
      await markRan(f.cfg, KEY, t0 + 5);
      assert.equal(readAnchorsSync(f.cfg).armed[KEY], t0, "markRan preserved the arm");

      await markArmed(f.cfg, "cron.doctor", t0 + 9);
      const after = readAnchorsSync(f.cfg);
      assert.equal(after.lastRun[KEY], t0 + 5, "markArmed preserved the run");
      assert.equal(after.armed["cron.doctor"], t0 + 9);
    } finally {
      f.cleanup();
    }
  });

  it("an arm stamp is never reported as a run", async () => {
    const f = fixture();
    try {
      // Seeding lastRun would have been the shorter fix and would have made
      // doctor claim a run that never happened. Freshness reporting has to
      // stay honest.
      const t0 = 1_700_000_000_000;
      await markArmed(f.cfg, KEY, t0);
      assert.deepEqual(await dueJobStatus(f.cfg, KEY, DAY, t0 + DAY), { ran: false, overdue: false });
      assert.deepEqual(readDueStateSync(f.cfg), {}, "the lastRun view ignores arms entirely");
    } finally {
      f.cleanup();
    }
  });

  it("a stamp from the future is ignored rather than parked forever", async () => {
    const f = fixture();
    try {
      const t0 = Date.now();
      await markRan(f.cfg, KEY, t0 + 30 * DAY); // clock moved back
      const job = register({
        schedule: { kind: "every", everyMs: DAY },
        cfg: f.cfg,
        anchorKey: KEY,
      });
      assert.ok(job.nextRunAt - t0 <= DAY + 1000, "a bad stamp must not delay the job a month");
    } finally {
      f.cleanup();
    }
  });

  it("payload jobs keep their deliberate no-catch-up", () => {
    const f = fixture();
    try {
      // The anchor is opt-in precisely so this stays true: nobody wants a
      // restart to burst the user messages it missed while down.
      const t0 = Date.now();
      const job = register({
        schedule: { kind: "every", everyMs: HOUR },
        cfg: f.cfg,
        handler: null,
        payload: { message: "hello" },
      });
      assert.equal(job.anchorKey, null);
      assert.ok(job.nextRunAt - t0 > HOUR - 60_000, "scheduled from now, as designed");
    } finally {
      f.cleanup();
    }
  });

  it("an anchored job stamps the ATTEMPT, so an interrupted run does not re-arm", async () => {
    const f = fixture();
    try {
      // Stamping on completion would mean a suite killed mid-run by a restart
      // is still overdue at the next boot — and at every boot after that. The
      // live suite takes ~54 minutes against a median uptime of 24.
      const job = register({
        schedule: { kind: "every", everyMs: DAY },
        cfg: f.cfg,
        anchorKey: KEY,
        handler: async () => {
          assert.ok(
            Number.isFinite(readDueStateSync(f.cfg)[KEY]),
            "the stamp must already be written while the job is still running"
          );
        },
      });
      await run(job.id, "manual");
      assert.equal(readDueStateSync(f.cfg)[KEY], job.lastRunAt);
    } finally {
      f.cleanup();
    }
  });

  it("a failing job still stamps, so a broken cron cannot retry every boot", async () => {
    const f = fixture();
    try {
      const job = register({
        schedule: { kind: "every", everyMs: DAY },
        cfg: f.cfg,
        anchorKey: KEY,
        handler: async () => {
          throw new Error("suite exploded");
        },
      });
      await run(job.id, "manual");
      assert.equal(job.lastStatus, "error");
      assert.match(job.lastError, /suite exploded/, "the error is reported, never swallowed");
      assert.equal(readDueStateSync(f.cfg)[KEY], job.lastRunAt, "stamped despite the failure");
    } finally {
      f.cleanup();
    }
  });

  it("an anchor without a config is inert and touches no shared stamp file", async () => {
    // Guards the real ~/.xclaw: a job registered bare must never read or write
    // the running gateway's schedule.
    const t0 = Date.now();
    const job = register({
      schedule: { kind: "every", everyMs: DAY },
      anchorKey: KEY,
      handler: async () => {},
    });
    assert.equal(job._cfg, null);
    assert.ok(job.nextRunAt - t0 > 23 * HOUR);
    await run(job.id, "manual");
    assert.equal(job.lastStatus, "ok");
  });

  it("readDueStateSync and readDueState agree, and both survive a corrupt file", async () => {
    const f = fixture();
    try {
      const t0 = 1_700_000_000_000;
      await markRan(f.cfg, KEY, t0);
      assert.deepEqual(readDueStateSync(f.cfg), await readDueState(f.cfg));

      fs.writeFileSync(dueStatePath(f.cfg), "{not json");
      assert.deepEqual(readDueStateSync(f.cfg), {}, "corrupt reads as never-run, never throws");
      assert.deepEqual(await readDueState(f.cfg), {});
    } finally {
      f.cleanup();
    }
  });

  it("concurrent stamps from different jobs do not clobber each other", async () => {
    const f = fixture();
    try {
      // Four jobs now share one stamp file. An unserialized read-modify-write
      // drops one, and a job whose stamp keeps vanishing re-runs at every boot
      // — the hot loop the stamp exists to prevent.
      const t0 = 1_700_000_000_000;
      await Promise.all([
        markRan(f.cfg, "ops.maintenance", t0),
        markRan(f.cfg, "cron.approvalDigest", t0 + 1),
        markRan(f.cfg, "cron.doctor", t0 + 2),
        markRan(f.cfg, KEY, t0 + 3),
      ]);
      const state = await readDueState(f.cfg);
      assert.equal(state["ops.maintenance"], t0);
      assert.equal(state["cron.approvalDigest"], t0 + 1);
      assert.equal(state["cron.doctor"], t0 + 2);
      assert.equal(state[KEY], t0 + 3);
    } finally {
      f.cleanup();
    }
  });

  it("dueJobStatus reports never-run, healthy and overdue", async () => {
    const f = fixture();
    try {
      const t0 = 1_700_000_000_000;
      assert.deepEqual(
        await dueJobStatus(f.cfg, KEY, DAY, t0),
        { ran: false, overdue: false },
        "never run is not a fault"
      );

      await markRan(f.cfg, KEY, t0);
      const healthy = await dueJobStatus(f.cfg, KEY, DAY, t0 + DAY);
      assert.equal(healthy.overdue, false, "one interval old is still healthy");
      assert.equal(healthy.ageHours, 24);

      // Past twice the interval the schedule itself is suspect — the state the
      // eval suite sat in for eleven days with nothing reporting it.
      const stale = await dueJobStatus(f.cfg, KEY, DAY, t0 + 2 * DAY + 1);
      assert.equal(stale.overdue, true, "past 2x interval must report overdue");
    } finally {
      f.cleanup();
    }
  });

  it("startPeriodic runs the boot catch-up, then stop() ends the schedule", async () => {
    // Still the ops job's arming path; the cron jobs above ride the scheduler.
    let ticks = 0;
    const h = startPeriodic({ intervalMs: DAY, bootDelayMs: 1, tick: () => ticks++ });
    await waitFor(() => ticks >= 1);
    h.stop();
    const after = ticks;
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(ticks, after, "no ticks after stop()");
    assert.equal(h.timers.length, 2, "boot timer and interval");
  });
});
