/**
 * A pid is only meaningful on the host that minted it.
 *
 * `acquireTelegramWriterLock` records `host: os.hostname()` in the lock payload
 * and then never reads it: the holder's pid is handed straight to `isPidAlive`,
 * which asks *this* machine's process table. Deleting the field entirely left
 * the whole lock suite green (2026-08-28), which is what a write-only field
 * looks like.
 *
 * That is a fail-open whenever `~/.xclaw` is not private to one machine — a
 * bind-mounted volume shared by a recreated container, a restored home
 * directory, an NFS home. Host B reads host A's fresh lock, tests A's pid
 * against B's process table, finds nothing, and takes the lock: two processes
 * on `getUpdates` for one bot token, which is the precise failure the lock
 * exists to prevent. (The coincidence case is the mirror: B finds an unrelated
 * live process wearing that pid and defers to a holder that no longer exists.)
 *
 * The doctor repeats the mistake one layer up. `assessTelegramWriter` already
 * has `host` in hand — it prints it — and still reports `held by live pid=N`
 * about a pid it cannot test, which is the same false-OK the module was written
 * to end.
 *
 * For a remote holder the renewal stamp is the only signal either side can
 * actually interpret, and the writer refreshes it every poll.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isSameHost } from "../src/shared/pid-alive.mjs";
import { acquireTelegramWriterLock } from "../src/channels/telegram/webhook.mjs";
import { assessTelegramWriter } from "../src/cli/doctor-telegram-writer.mjs";

const REMOTE = "some-other-box.xclaw.test";
const STALE_MS = 120_000;

/** A pid this process can prove is gone, without signalling a real one. */
const DEAD = 0x7ffffffe;
const alwaysDead = () => false;
const alwaysAlive = () => true;

function withLock({ host, ageMs, pid }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-wlock-"));
  const lockPath = path.join(dir, "telegram-writer.lock");
  const payload = { pid, at: new Date(Date.now() - ageMs).toISOString() };
  if (host !== null) payload.host = host;
  fs.writeFileSync(lockPath, JSON.stringify(payload), "utf8");
  try {
    return fn(lockPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("isSameHost: a pid is interpretable only where it was minted", () => {
  test("an exact match is local", () => {
    assert.equal(isSameHost("box-a", "box-a"), true);
  });

  test("a different host is remote", () => {
    assert.equal(isSameHost("box-a", "box-b"), false);
  });

  test("hostname case is not a difference", () => {
    // os.hostname() casing varies by platform; a false "remote" verdict would
    // silently downgrade a perfectly testable local pid.
    assert.equal(isSameHost("Box-A.local", "box-a.local"), true);
  });

  test("an unrecorded host cannot prove remoteness, so it stays local", () => {
    // Locks written before the field existed must keep today's behaviour.
    for (const missing of [undefined, null, "", "   ", 0, {}]) {
      assert.equal(isSameHost(missing, "box-a"), true, String(missing));
    }
  });

  test("it defaults to this machine", () => {
    assert.equal(isSameHost(os.hostname()), true);
    assert.equal(isSameHost(REMOTE), false);
  });
});

describe("acquireTelegramWriterLock: a remote holder is not judged by a local pid", () => {
  test("a fresh remote lock is NOT stolen because its pid is absent here", () => {
    withLock({ host: REMOTE, ageMs: 5_000, pid: DEAD }, (lockPath) => {
      const r = acquireTelegramWriterLock({
        lockPath,
        staleMs: STALE_MS,
        isAlive: alwaysDead,
      });
      assert.equal(r.ok, false, "stole a live remote poller's lock");
      assert.equal(r.reason, "lock_held_remote");
      assert.equal(r.holder.host, REMOTE);
      // The holder's stamp must survive: overwriting it is the steal.
      const still = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      assert.equal(still.pid, DEAD);
      assert.equal(still.host, REMOTE);
    });
  });

  test("a stale remote lock is reclaimable — a dead host must not wedge intake", () => {
    withLock({ host: REMOTE, ageMs: STALE_MS + 5_000, pid: process.pid }, (lockPath) => {
      const r = acquireTelegramWriterLock({
        lockPath,
        staleMs: STALE_MS,
        isAlive: alwaysAlive,
      });
      assert.equal(r.ok, true, "a stale remote lock left intake permanently down");
      const now = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      assert.equal(now.pid, process.pid);
      assert.equal(now.host, os.hostname());
    });
  });

  test("a remote pid that collides with a live local one is still just remote", () => {
    // The pid number is not evidence either way off its own host.
    withLock({ host: REMOTE, ageMs: 5_000, pid: process.pid }, (lockPath) => {
      const r = acquireTelegramWriterLock({ lockPath, staleMs: STALE_MS });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "lock_held_remote");
    });
  });

  test("same-host behaviour is unchanged in every combination", () => {
    const here = os.hostname();
    const cases = [
      { name: "fresh + alive => held", ageMs: 5_000, isAlive: alwaysAlive, pid: DEAD, ok: false },
      { name: "fresh + dead => reclaim", ageMs: 5_000, isAlive: alwaysDead, pid: DEAD, ok: true },
      {
        name: "stale + alive => reclaim",
        ageMs: STALE_MS + 5_000,
        isAlive: alwaysAlive,
        pid: DEAD,
        ok: true,
      },
      {
        name: "stale + dead => reclaim",
        ageMs: STALE_MS + 5_000,
        isAlive: alwaysDead,
        pid: DEAD,
        ok: true,
      },
    ];
    for (const c of cases) {
      withLock({ host: here, ageMs: c.ageMs, pid: c.pid }, (lockPath) => {
        const r = acquireTelegramWriterLock({
          lockPath,
          staleMs: STALE_MS,
          isAlive: c.isAlive,
        });
        assert.equal(r.ok, c.ok, c.name);
        if (!c.ok) assert.equal(r.reason, "lock_held", c.name);
      });
    }
  });

  test("a legacy lock with no host is still judged by its pid", () => {
    withLock({ host: null, ageMs: 5_000, pid: DEAD }, (lockPath) => {
      const held = acquireTelegramWriterLock({
        lockPath,
        staleMs: STALE_MS,
        isAlive: alwaysAlive,
      });
      assert.equal(held.ok, false, "a live pid in a pre-host lock must still hold");
      assert.equal(held.reason, "lock_held");
    });
    withLock({ host: null, ageMs: 5_000, pid: DEAD }, (lockPath) => {
      const free = acquireTelegramWriterLock({
        lockPath,
        staleMs: STALE_MS,
        isAlive: alwaysDead,
      });
      assert.equal(free.ok, true, "a gone pid in a pre-host lock must be reclaimable");
    });
  });

  test("re-acquiring our own local lock still succeeds", () => {
    withLock({ host: os.hostname(), ageMs: 5_000, pid: process.pid }, (lockPath) => {
      const r = acquireTelegramWriterLock({
        lockPath,
        staleMs: STALE_MS,
        isAlive: alwaysAlive,
      });
      assert.equal(r.ok, true);
    });
  });
});

describe("doctor does not claim liveness it cannot test", () => {
  const base = {
    enabled: true,
    singleWriter: true,
    lockPath: "/tmp/x.lock",
    present: true,
    now: Date.now(),
    staleMs: STALE_MS,
  };
  const raw = (host, ageMs, pid = 4242) =>
    JSON.stringify({ pid, host, at: new Date(base.now - ageMs).toISOString() });
  const find = (fs_, id) => fs_.find((f) => f.id === id);

  test("a fresh remote holder is healthy, and is never called live", () => {
    const out = assessTelegramWriter({ ...base, raw: raw(REMOTE, 5_000), isAlive: alwaysDead });
    const lock = find(out, "telegram.writerLock");
    assert.equal(lock.level, "ok", `remote holder reported ${lock.level}: ${lock.summary}`);
    assert.match(lock.summary, new RegExp(REMOTE.replace(/\./g, "\\.")));
    assert.doesNotMatch(lock.summary, /\blive\b/, lock.summary);
    assert.doesNotMatch(lock.summary, /\bgone\b/, lock.summary);
  });

  test("a live-looking local pid does not license a liveness claim about a remote one", () => {
    const out = assessTelegramWriter({ ...base, raw: raw(REMOTE, 5_000), isAlive: alwaysAlive });
    const lock = find(out, "telegram.writerLock");
    assert.doesNotMatch(lock.summary, /\blive\b/, lock.summary);
  });

  test("a stale remote lock warns without asserting the pid exited", () => {
    const out = assessTelegramWriter({
      ...base,
      raw: raw(REMOTE, STALE_MS + 5_000),
      isAlive: alwaysDead,
    });
    const lock = find(out, "telegram.writerLock");
    assert.equal(lock.level, "warn");
    assert.doesNotMatch(lock.summary, /is gone|exited/, lock.summary);
    assert.match(lock.summary, new RegExp(REMOTE.replace(/\./g, "\\.")));
  });

  test("the local report is untouched", () => {
    const here = os.hostname();
    const ok = assessTelegramWriter({ ...base, raw: raw(here, 11_000), isAlive: alwaysAlive });
    assert.equal(find(ok, "telegram.writerLock").level, "ok");
    assert.match(find(ok, "telegram.writerLock").summary, /held by live pid=4242 host=/);

    const dead = assessTelegramWriter({ ...base, raw: raw(here, 11_000), isAlive: alwaysDead });
    assert.equal(find(dead, "telegram.writerLock").level, "warn");
    assert.match(find(dead, "telegram.writerLock").summary, /is gone/);
  });
});
