/**
 * Telegram writer-lock health as a pure decision.
 *
 * Why this module exists. The CLI doctor used to answer "is Telegram running?"
 * by constructing its own `createChannelManager(cfg)` and printing that
 * manager's `running` field. `running` is `enabled && loopAlive && !stopped`
 * and `loopAlive` is a closure-local flag set only when *that* process starts
 * the poll loop — so in any CLI process it is unconditionally false. The probe
 * printed `[OK] telegram.runtime: running=false` whether Telegram was healthy,
 * wedged, or never configured: a constant dressed as an observation. It was
 * diagnosed on 2026-08-24 and recorded as a caveat ("use the gateway's /doctor
 * route for truth") instead of being removed, so the misleading OK stayed.
 *
 * The honest cross-process signal is the single-writer lock itself. Exactly one
 * process owns Telegram updates, it takes `~/.xclaw/locks/telegram-writer.lock`
 * before starting, and `runTelegramPollLoop` touches the lock at the top of
 * every iteration — so the stamp is refreshed at least once per long-poll
 * (30s by default). `acquireTelegramWriterLock` already decides a lock is
 * reclaimable when the holder pid is gone or the stamp is older than
 * `staleMs`; those are precisely the states the old probe reported as OK.
 * This module applies the writer's own predicate to the reader's side.
 *
 * Pure by construction: the caller does the filesystem read and passes the
 * bytes in, so every branch below is reachable from a unit test.
 */

/** Must track `acquireTelegramWriterLock`'s default in channels/telegram/webhook.mjs. */
export const WRITER_LOCK_STALE_MS = 120_000;

/**
 * Reader and writer must agree on liveness or the doctor reports "held by a
 * live pid" while acquisition steals that same lock. Both now ask the one
 * primitive; this re-export keeps the name callers already import.
 */
import { isPidAlive } from "../shared/pid-alive.mjs";

export { isPidAlive };

const secs = (ms) => `${Math.max(0, Math.round(ms / 1000))}s`;

/**
 * @typedef {{id: string, level: "ok"|"warn", summary: string}} Finding
 *
 * @param {object} ev evidence gathered by the caller
 * @param {boolean} ev.enabled telegram is configured to run here
 * @param {boolean} ev.singleWriter the writer lock is in use (default on)
 * @param {string} ev.lockPath resolved lock path (honours writerLockPath)
 * @param {boolean} ev.present lock file exists
 * @param {string|null} [ev.raw] lock file contents
 * @param {string|null} [ev.readError] filesystem error, if the read failed
 * @param {string} [ev.transport] "long-poll" | "webhook", for the summary
 * @param {number} [ev.now]
 * @param {number} [ev.staleMs]
 * @param {(pid: number) => boolean} [ev.isAlive]
 * @returns {Finding[]} always one telegram.writerLock and one telegram.runtime
 */
export function assessTelegramWriter(ev) {
  const {
    enabled,
    singleWriter,
    lockPath,
    present,
    raw = null,
    readError = null,
    transport = "long-poll",
    now = Date.now(),
    staleMs = WRITER_LOCK_STALE_MS,
    isAlive = isPidAlive,
  } = ev;

  const out = (lock, runtime) => [
    { id: "telegram.writerLock", ...lock },
    { id: "telegram.runtime", ...runtime },
  ];

  if (readError) {
    return out(
      { level: "warn", summary: `lock unreadable at ${lockPath}: ${readError}` },
      { level: "warn", summary: "cannot determine whether a process owns Telegram updates" }
    );
  }

  if (!singleWriter) {
    return out(
      { level: "ok", summary: "singleWriter disabled — no lock taken by design" },
      { level: "ok", summary: "ownership not tracked (singleWriter disabled)" }
    );
  }

  if (!present) {
    // The lock is taken in startInner() before the loop runs, so its absence
    // means no process has started the writer — an outage when telegram is
    // configured, and the expected state when it is not.
    return enabled
      ? out(
          { level: "warn", summary: `no lock at ${lockPath} — no process owns Telegram updates` },
          { level: "warn", summary: "not polling: no writer holds the lock (gateway down?)" }
        )
      : out(
          { level: "ok", summary: "no lock (telegram not enabled here)" },
          { level: "ok", summary: "telegram not enabled here" }
        );
  }

  let held = null;
  try {
    held = JSON.parse(String(raw ?? ""));
  } catch {
    /* reported below */
  }
  const pid = Number(held?.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    return out(
      { level: "warn", summary: `lock present at ${lockPath} but has no usable pid` },
      { level: "warn", summary: "cannot confirm an owner for Telegram updates" }
    );
  }

  const stampedAt = Date.parse(held?.at || "");
  const alive = isAlive(pid);
  const where = held?.host ? ` host=${held.host}` : "";

  if (!alive) {
    return out(
      {
        level: "warn",
        summary: `stale lock: holder pid=${pid} is gone${where} — nothing owns Telegram updates (next start reclaims it)`,
      },
      { level: "warn", summary: `not polling: lock holder pid=${pid} exited` }
    );
  }

  if (!Number.isFinite(stampedAt)) {
    return out(
      { level: "warn", summary: `lock held by live pid=${pid}${where} but carries no timestamp` },
      { level: "warn", summary: `owner pid=${pid} alive, but liveness of the poll loop is unprovable` }
    );
  }

  const age = now - stampedAt;
  if (age >= staleMs) {
    // The process is up but the loop stopped renewing: the outage shape a bare
    // pid check misses.
    return out(
      {
        level: "warn",
        summary: `lock held by live pid=${pid}${where} but not renewed for ${secs(age)} (>= ${secs(staleMs)}) — poll loop wedged`,
      },
      { level: "warn", summary: `poll loop not advancing: owner pid=${pid} last renewed ${secs(age)} ago` }
    );
  }

  return out(
    { level: "ok", summary: `held by live pid=${pid}${where} renewed ${secs(age)} ago` },
    { level: "ok", summary: `owner pid=${pid} transport=${transport} renewed ${secs(age)} ago` }
  );
}

export default { assessTelegramWriter, isPidAlive, WRITER_LOCK_STALE_MS };
