import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import {
  assessTelegramWriter,
  isPidAlive,
  WRITER_LOCK_STALE_MS,
} from "../src/cli/doctor-telegram-writer.mjs";

// The CLI doctor reported `[OK] telegram.writerLock: lock present` for a lock
// whose holder had died, and `[OK] telegram.runtime: running=false` in every
// state — `running` is a closure-local flag in the channel, so a manager built
// inside the CLI can never report anything else. Both are pinned here as
// verdicts, not strings: a lock nobody holds is not OK.
const NOW = Date.parse("2026-08-28T12:00:00.000Z");
const lockAt = (agoMs) => new Date(NOW - agoMs).toISOString();
// A pid can only be looked up on the host that minted it, so these
// pid-liveness cases are stamped local; the cross-host rules live in
// test/telegram-writer-lock-host.test.mjs.
const lockFor = (pid, agoMs) =>
  JSON.stringify({ pid, at: lockAt(agoMs), host: os.hostname() });

function assess(over = {}) {
  const findings = assessTelegramWriter({
    enabled: true,
    singleWriter: true,
    lockPath: "/lock",
    present: true,
    now: NOW,
    isAlive: () => true,
    ...over,
  });
  return Object.fromEntries(findings.map((f) => [f.id, f]));
}

describe("telegram writer-lock assessment", () => {
  it("always reports exactly the two probe ids", () => {
    for (const over of [
      {},
      { present: false },
      { singleWriter: false },
      { readError: "EACCES" },
      { raw: "{ not json" },
    ]) {
      const ids = assessTelegramWriter({
        enabled: true,
        singleWriter: true,
        lockPath: "/lock",
        present: true,
        raw: lockFor(42, 1000),
        now: NOW,
        isAlive: () => true,
        ...over,
      }).map((f) => f.id);
      assert.deepEqual(ids, ["telegram.writerLock", "telegram.runtime"]);
    }
  });

  it("passes a lock held by a live process that is renewing it", () => {
    const f = assess({ raw: lockFor(4242, 12_000) });
    assert.equal(f["telegram.writerLock"].level, "ok");
    assert.equal(f["telegram.runtime"].level, "ok");
    assert.match(f["telegram.writerLock"].summary, /pid=4242/);
    assert.match(f["telegram.runtime"].summary, /renewed 12s ago/);
    // The old probe's constant. It must not come back.
    assert.doesNotMatch(f["telegram.runtime"].summary, /running=/);
  });

  it("warns when the lock holder is gone", () => {
    const f = assess({ raw: lockFor(4242, 1_000), isAlive: () => false });
    assert.equal(f["telegram.writerLock"].level, "warn");
    assert.equal(f["telegram.runtime"].level, "warn");
    assert.match(f["telegram.writerLock"].summary, /stale lock.*pid=4242 is gone/);
  });

  it("warns when a live holder stopped renewing the lock", () => {
    // Process up, poll loop wedged — invisible to a pid check alone.
    const f = assess({ raw: lockFor(4242, WRITER_LOCK_STALE_MS + 1_000) });
    assert.equal(f["telegram.writerLock"].level, "warn");
    assert.match(f["telegram.writerLock"].summary, /not renewed for 121s/);
    assert.match(f["telegram.runtime"].summary, /not advancing/);
  });

  it("holds a lock renewed just inside the stale window", () => {
    const f = assess({ raw: lockFor(4242, WRITER_LOCK_STALE_MS - 1_000) });
    assert.equal(f["telegram.writerLock"].level, "ok");
  });

  it("warns when telegram is enabled but no process holds the lock", () => {
    const f = assess({ present: false, raw: null });
    assert.equal(f["telegram.writerLock"].level, "warn");
    assert.match(f["telegram.writerLock"].summary, /no process owns Telegram updates/);
  });

  it("stays quiet when telegram is not enabled here", () => {
    const f = assess({ present: false, raw: null, enabled: false });
    assert.equal(f["telegram.writerLock"].level, "ok");
    assert.equal(f["telegram.runtime"].level, "ok");
  });

  it("stays quiet when singleWriter is off, since no lock is expected", () => {
    const f = assess({ present: false, raw: null, singleWriter: false });
    assert.equal(f["telegram.writerLock"].level, "ok");
    assert.match(f["telegram.runtime"].summary, /not tracked/);
  });

  it("warns on an unreadable or pid-less lock instead of assuming health", () => {
    for (const raw of ["{ not json", "{}", '{"pid":0}']) {
      const f = assess({ raw });
      assert.equal(f["telegram.writerLock"].level, "warn", raw);
      assert.equal(f["telegram.runtime"].level, "warn", raw);
    }
    const err = assess({ readError: "EACCES: permission denied" });
    assert.equal(err["telegram.writerLock"].level, "warn");
    assert.match(err["telegram.writerLock"].summary, /EACCES/);
  });

  it("warns when a live holder wrote no timestamp", () => {
    const f = assess({ raw: JSON.stringify({ pid: 7 }) });
    assert.equal(f["telegram.writerLock"].level, "warn");
    assert.match(f["telegram.writerLock"].summary, /no timestamp/);
  });

  it("tolerates clock skew rather than reporting a negative age", () => {
    const f = assess({ raw: lockFor(4242, -5_000) });
    assert.equal(f["telegram.writerLock"].level, "ok");
    assert.match(f["telegram.writerLock"].summary, /renewed 0s ago/);
  });
});

describe("pid liveness", () => {
  const err = (code) => () => {
    const e = new Error(code);
    e.code = code;
    throw e;
  };

  it("treats a signalable process as alive", () => {
    assert.equal(isPidAlive(1234, () => {}), true);
  });

  it("treats ESRCH as gone and EPERM as alive", () => {
    // EPERM is another user's live process; only ESRCH proves absence.
    assert.equal(isPidAlive(1234, err("ESRCH")), false);
    assert.equal(isPidAlive(1234, err("EPERM")), true);
  });

  it("rejects pids that cannot identify a process", () => {
    for (const pid of [0, -1, NaN, undefined, "12"]) {
      assert.equal(isPidAlive(pid, () => {}), false, String(pid));
    }
  });

  it("agrees with the real process table for this process", () => {
    assert.equal(isPidAlive(process.pid), true);
  });
});
