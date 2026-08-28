/**
 * The daily ops job used to be a bare `setInterval(…, 24h)` armed at gateway
 * boot. That only fires if ONE process instance survives 24 uninterrupted
 * hours, so a host that redeploys more often than that performed maintenance
 * NEVER — and silently, since nothing logs a run that did not happen.
 *
 * Live proof (2026-08-28): the gateway log held 337 boots, the sweep had
 * fired 5 times, last on 2026-08-22 — six days of release restarts left
 * 83,671 stale /tmp/xclaw-* entries, with ledger compaction and JSONL
 * rotation suspended alongside it.
 *
 * These pin the property the old scheduler lacked: due-ness survives a
 * restart. A boot after an overdue gap runs the job; a boot minutes later
 * does not; and the stamp advances so the next boot holds off.
 *
 * Side-effect discipline: runOpsMaintenance targets HOST-GLOBAL files
 * (router-events, cost-ledger, cron logs), so every cfg here disables that
 * half, and the sweep half is aimed at a throwaway TMPDIR fixture.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDue, markRan, readDueState, dueStatePath } from "../src/ops/due.mjs";
import {
  runDueOps,
  startOpsSchedule,
  opsIntervalMs,
  opsScheduleEnabled,
  OPS_JOB,
} from "../src/ops/scheduler.mjs";

const DAY = 24 * 3600 * 1000;

/** Isolated config dir + a fixture tmpdir the sweep half is allowed to touch. */
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opssched-"));
  const fakeTmp = path.join(dir, "tmp");
  fs.mkdirSync(fakeTmp);
  return {
    dir,
    fakeTmp,
    cfg: {
      paths: { configDir: dir },
      ops: { maintenance: { enabled: false } }, // never touch host-global files
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** os.tmpdir() reads TMPDIR per call on POSIX, so the sweep half stays boxed. */
async function withTmpdir(dir, fn) {
  const prev = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = prev;
  }
}

async function waitFor(pred, timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    if (await pred()) return;
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("ops schedule survives restarts (due stamp, not process uptime)", () => {
  it("never-run is due; a fresh stamp is not; an elapsed interval is due again", async () => {
    const f = fixture();
    try {
      const t0 = 1_700_000_000_000;
      assert.equal(await isDue(f.cfg, OPS_JOB, DAY, t0), true, "never run → due");

      await markRan(f.cfg, OPS_JOB, t0);
      assert.equal(await isDue(f.cfg, OPS_JOB, DAY, t0 + 60_000), false, "just ran → not due");
      assert.equal(
        await isDue(f.cfg, OPS_JOB, DAY, t0 + DAY - 1),
        false,
        "one ms short of the interval → still not due",
      );
      assert.equal(await isDue(f.cfg, OPS_JOB, DAY, t0 + DAY), true, "interval elapsed → due");
      assert.equal(
        await isDue(f.cfg, OPS_JOB, DAY, t0 - 5_000),
        true,
        "stamp in the future (clock moved back) → due, never wedged off",
      );
    } finally {
      f.cleanup();
    }
  });

  it("a corrupt or absent stamp file fails toward doing the work", async () => {
    const f = fixture();
    try {
      assert.deepEqual(await readDueState(f.cfg), {}, "absent → empty");
      fs.writeFileSync(dueStatePath(f.cfg), "{not json");
      assert.deepEqual(await readDueState(f.cfg), {}, "corrupt → empty");
      assert.equal(await isDue(f.cfg, OPS_JOB, DAY), true, "corrupt → due");
    } finally {
      f.cleanup();
    }
  });

  it("THE REGRESSION: a boot after an overdue gap runs the job; uptime is irrelevant", async () => {
    const f = fixture();
    try {
      const t0 = 1_700_000_000_000;
      // The live host's shape: last real run six days back, then a long series
      // of short-lived processes. Each runDueOps below is a fresh boot with
      // zero uptime — the old inline setInterval(24h) ran nothing in any of them.
      await markRan(f.cfg, OPS_JOB, t0 - 6 * DAY);

      const first = await withTmpdir(f.fakeTmp, () =>
        runDueOps(f.cfg, { now: t0, intervalMs: DAY }),
      );
      assert.equal(first.ran, true, "an overdue job must run on boot");
      assert.deepEqual(first.errors, [], "the run must not error");
      assert.ok(first.tmp, "the sweep half ran");

      assert.equal((await readDueState(f.cfg))[OPS_JOB], t0, "the run stamps its time");

      const second = await withTmpdir(f.fakeTmp, () =>
        runDueOps(f.cfg, { now: t0 + 60_000, intervalMs: DAY }),
      );
      assert.equal(second.ran, false, "a boot minutes later must NOT re-run");
      assert.equal(second.skipped, "not-due");

      const third = await withTmpdir(f.fakeTmp, () =>
        runDueOps(f.cfg, { now: t0 + DAY + 1, intervalMs: DAY }),
      );
      assert.equal(third.ran, true, "the next interval boot runs again");
    } finally {
      f.cleanup();
    }
  });

  it("the sweep half removes stale entries and keeps fresh ones", async () => {
    const f = fixture();
    try {
      const stale = path.join(f.fakeTmp, "xclaw-old-worktree");
      const fresh = path.join(f.fakeTmp, "xclaw-new-worktree");
      const foreign = path.join(f.fakeTmp, "someone-elses-dir");
      for (const d of [stale, fresh, foreign]) fs.mkdirSync(d);
      const old = new Date(Date.now() - 8 * DAY);
      fs.utimesSync(stale, old, old);
      fs.utimesSync(foreign, old, old);

      const r = await withTmpdir(f.fakeTmp, () =>
        runDueOps(f.cfg, { now: Date.now(), intervalMs: DAY }),
      );
      assert.equal(r.ran, true);
      assert.deepEqual(r.tmp.removed, ["xclaw-old-worktree"], "only the stale xclaw entry goes");
      assert.equal(fs.existsSync(stale), false, "stale entry removed");
      assert.equal(fs.existsSync(fresh), true, "fresh entry kept");
      assert.equal(fs.existsSync(foreign), true, "non-xclaw entry never touched");
    } finally {
      f.cleanup();
    }
  });

  it("a failing run still stamps, so a broken job cannot hot-loop every boot", async () => {
    const f = fixture();
    try {
      // point the sweep at a path that cannot be read → the half errors
      const gone = path.join(f.dir, "does-not-exist");
      const t0 = 1_700_000_000_000;
      const r = await withTmpdir(gone, () => runDueOps(f.cfg, { now: t0, intervalMs: DAY }));
      assert.equal(r.ran, true, "the attempt counts as a run");
      assert.equal(
        (await readDueState(f.cfg))[OPS_JOB],
        t0,
        "stamped despite the failure — no boot-loop",
      );
      const next = await withTmpdir(gone, () =>
        runDueOps(f.cfg, { now: t0 + 1000, intervalMs: DAY }),
      );
      assert.equal(next.ran, false, "the immediate retry is held off");
    } finally {
      f.cleanup();
    }
  });

  it("disabling both halves disarms the schedule entirely", async () => {
    const f = fixture();
    try {
      const off = {
        ...f.cfg,
        ops: { tmpSweep: { enabled: false }, maintenance: { enabled: false } },
      };
      assert.equal(opsScheduleEnabled(off), false);
      const r = await runDueOps(off, { now: Date.now() });
      assert.equal(r.ran, false);
      assert.equal(r.skipped, "disabled");
      assert.equal(startOpsSchedule(off).enabled, false, "no timers armed");
      assert.equal(fs.existsSync(dueStatePath(off)), false, "a disabled job writes no stamp");
    } finally {
      f.cleanup();
    }
  });

  it("startOpsSchedule performs the overdue catch-up shortly after boot", async () => {
    const f = fixture();
    try {
      await markRan(f.cfg, OPS_JOB, Date.now() - 3 * DAY);
      const before = (await readDueState(f.cfg))[OPS_JOB];
      const h = await withTmpdir(f.fakeTmp, async () => {
        const handle = startOpsSchedule(f.cfg, {
          bootDelayMs: 1,
          intervalMs: DAY,
          log: () => {},
          warn: () => {},
        });
        assert.equal(handle.enabled, true);
        await waitFor(async () => (await readDueState(f.cfg))[OPS_JOB] !== before);
        return handle;
      });
      h.stop();
      const after = (await readDueState(f.cfg))[OPS_JOB];
      assert.ok(after > before, "boot catch-up ran the overdue job and re-stamped");
      assert.ok(after > Date.now() - 60_000, "the new stamp is current");
    } finally {
      f.cleanup();
    }
  });

  it("interval resolution keeps the 1h floor and honours config", () => {
    assert.equal(opsIntervalMs({}), DAY);
    assert.equal(opsIntervalMs({ ops: { maintenance: { intervalMs: 60_000 } } }), 3_600_000);
    assert.equal(
      opsIntervalMs({ ops: { maintenance: { intervalMs: 6 * 3600_000 } } }),
      6 * 3600_000,
    );
    assert.equal(opsIntervalMs({ ops: { tmpSweep: { intervalMs: 2 * 3600_000 } } }), 2 * 3600_000);
  });
});
