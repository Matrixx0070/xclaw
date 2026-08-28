/**
 * The approval digest was the last timer in the tree with the fail-open shape
 * fixed for the ops job in v3.283.0: a bare
 * `setInterval(sendApprovalDigest, cfg.security.digestIntervalMs)` armed at
 * gateway boot, with no boot run and no durable stamp.
 *
 * The natural setting for this feature is a daily digest, and the live host
 * redeploys several times a day — so that timer would never once have fired,
 * silently, because a digest that is not sent logs nothing. (Latent when
 * found: digestIntervalMs is unset on the live host.)
 *
 * These pin the property the inline timer lacked — due-ness survives a restart
 * — plus the serialization that a SECOND adopter of the shared stamp file made
 * necessary.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  markRan,
  readDueState,
  dueStatePath,
  dueJobStatus,
  startPeriodic,
} from "../src/ops/due.mjs";
import {
  runDueDigest,
  startApprovalDigestSchedule,
  DIGEST_JOB,
} from "../src/security/approval-digest.mjs";

const DAY = 24 * 3600 * 1000;

/** Isolated config dir. No approval gate is ever constructed by these tests. */
function fixture(intervalMs = DAY) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "digestsched-"));
  return {
    dir,
    cfg: { paths: { configDir: dir }, security: { digestIntervalMs: intervalMs } },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** Counting stand-in for sendApprovalDigest. */
function recorder(impl) {
  const calls = [];
  return {
    calls,
    send: async (cfg, opts) => {
      calls.push({ cfg, opts });
      return impl ? impl() : { sent: true };
    },
  };
}

async function waitFor(pred, timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    if (await pred()) return;
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("approval digest schedule survives restarts", () => {
  it("an unconfigured digest is disabled, arms nothing and writes no stamp", async () => {
    const f = fixture();
    try {
      const off = { paths: { configDir: f.dir }, security: {} };
      const r = await runDueDigest(off, { send: async () => assert.fail("must not send") });
      assert.equal(r.ran, false);
      assert.equal(r.skipped, "disabled");
      assert.equal(startApprovalDigestSchedule(off).enabled, false, "no timers armed");
      assert.equal(fs.existsSync(dueStatePath(off)), false, "a disabled job writes no stamp");
    } finally {
      f.cleanup();
    }
  });

  it("THE REGRESSION: a boot after an overdue gap sends; uptime is irrelevant", async () => {
    const f = fixture();
    try {
      const t0 = 1_700_000_000_000;
      // The live host's shape: a long gap, then a series of short-lived
      // processes. The old inline interval sent nothing in any of them.
      await markRan(f.cfg, DIGEST_JOB, t0 - 6 * DAY);
      const rec = recorder();

      const first = await runDueDigest(f.cfg, { now: t0, send: rec.send });
      assert.equal(first.ran, true, "an overdue digest must send on boot");
      assert.equal(first.error, undefined);
      assert.equal(rec.calls.length, 1);
      assert.equal((await readDueState(f.cfg))[DIGEST_JOB], t0, "the send stamps its time");

      const second = await runDueDigest(f.cfg, { now: t0 + 60_000, send: rec.send });
      assert.equal(second.ran, false, "a boot minutes later must NOT re-send");
      assert.equal(second.skipped, "not-due");
      assert.equal(rec.calls.length, 1, "no second send");

      const third = await runDueDigest(f.cfg, { now: t0 + DAY + 1, send: rec.send });
      assert.equal(third.ran, true, "the next interval boot sends again");
      assert.equal(rec.calls.length, 2);
    } finally {
      f.cleanup();
    }
  });

  it("a never-run digest is due immediately", async () => {
    const f = fixture();
    try {
      const rec = recorder();
      const r = await runDueDigest(f.cfg, { now: 1_700_000_000_000, send: rec.send });
      assert.equal(r.ran, true);
      assert.equal(rec.calls.length, 1);
    } finally {
      f.cleanup();
    }
  });

  it("a failing send still stamps, so a broken digest cannot retry every boot", async () => {
    const f = fixture();
    try {
      const t0 = 1_700_000_000_000;
      const rec = recorder(() => {
        throw new Error("delivery exploded");
      });
      const r = await runDueDigest(f.cfg, { now: t0, send: rec.send });
      assert.equal(r.ran, true, "the attempt counts as a run");
      assert.match(r.error, /delivery exploded/, "the error is reported, never swallowed silently");
      assert.equal((await readDueState(f.cfg))[DIGEST_JOB], t0, "stamped despite the failure");

      const next = await runDueDigest(f.cfg, { now: t0 + 1000, send: rec.send });
      assert.equal(next.ran, false, "the immediate retry is held off");
      assert.equal(rec.calls.length, 1);
    } finally {
      f.cleanup();
    }
  });

  it("concurrent stamps from different jobs do not clobber each other", async () => {
    const f = fixture();
    try {
      // Two jobs now share one stamp file. An unserialized read-modify-write
      // drops one stamp, and a job whose stamp keeps vanishing re-runs at
      // every boot — the hot-loop the stamp exists to prevent.
      const t0 = 1_700_000_000_000;
      await Promise.all([
        markRan(f.cfg, "ops.maintenance", t0),
        markRan(f.cfg, DIGEST_JOB, t0 + 1),
        markRan(f.cfg, "third.job", t0 + 2),
      ]);
      const state = await readDueState(f.cfg);
      assert.equal(state["ops.maintenance"], t0, "ops stamp survived");
      assert.equal(state[DIGEST_JOB], t0 + 1, "digest stamp survived");
      assert.equal(state["third.job"], t0 + 2, "third stamp survived");
    } finally {
      f.cleanup();
    }
  });

  it("dueJobStatus reports never-run, healthy and overdue", async () => {
    const f = fixture();
    try {
      const t0 = 1_700_000_000_000;
      const fresh = await dueJobStatus(f.cfg, DIGEST_JOB, DAY, t0);
      assert.deepEqual(fresh, { ran: false, overdue: false }, "never run is not a fault");

      await markRan(f.cfg, DIGEST_JOB, t0);
      const healthy = await dueJobStatus(f.cfg, DIGEST_JOB, DAY, t0 + DAY);
      assert.equal(healthy.ran, true);
      assert.equal(healthy.overdue, false, "one interval old is still healthy");
      assert.equal(healthy.ageHours, 24);

      // Past twice the interval the schedule itself is suspect — this is the
      // state that stayed invisible for six days.
      const stale = await dueJobStatus(f.cfg, DIGEST_JOB, DAY, t0 + 2 * DAY + 1);
      assert.equal(stale.overdue, true, "past 2x interval must report overdue");
    } finally {
      f.cleanup();
    }
  });

  it("startPeriodic runs the boot catch-up, then stop() ends the schedule", async () => {
    let ticks = 0;
    const h = startPeriodic({ intervalMs: DAY, bootDelayMs: 1, tick: () => ticks++ });
    await waitFor(() => ticks >= 1);
    h.stop();
    const after = ticks;
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(ticks, after, "no ticks after stop()");
    assert.equal(h.timers.length, 2, "boot timer and interval");
  });

  it("a configured digest arms a schedule and reports its interval", () => {
    const f = fixture(6 * 3600_000);
    try {
      // bootDelayMs is generous and the handle is stopped at once, so no tick
      // runs here — this asserts arming only.
      const h = startApprovalDigestSchedule(f.cfg, { bootDelayMs: 60_000 });
      try {
        assert.equal(h.enabled, true);
        assert.equal(h.intervalMs, 6 * 3600_000);
      } finally {
        h.stop();
      }
    } finally {
      f.cleanup();
    }
  });
});
