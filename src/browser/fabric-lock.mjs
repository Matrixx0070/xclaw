/**
 * A8 — Cross-process fabric lock (file-based).
 *
 * Protects RMW on tab-leases.json, commit-gates.json, session-roles.json, clock.json.
 * Uses exclusive lockfile + stale reclaim (dead pid).
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { isPidAlive } from "../shared/pid-alive.mjs";

function fabricRoot() {
  return (
    process.env.XCLAW_FABRIC_DIR ||
    path.join(os.homedir(), ".xclaw", "fabric")
  );
}

function lockPath(name = "fabric", root = null) {
  return path.join(root || fabricRoot(), `${name}.lock`);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Acquire exclusive lock. Returns release function.
 * @param {object} [opts]
 * @param {string} [opts.name]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.staleMs] reclaim if lock older than this and pid dead
 * @param {string} [opts.root] lock directory — defaults to the fabric root.
 *   Pass this to reuse the same exclusive-lockfile + stale-pid-reclaim
 *   algorithm for other JSON stores (e.g. automations) instead of
 *   duplicating it.
 */
export async function acquireFabricLock(opts = {}) {
  const name = opts.name || "fabric";
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const staleMs = opts.staleMs ?? 30_000;
  const root = opts.root || fabricRoot();
  await fs.mkdir(root, { recursive: true });
  const lp = lockPath(name, root);
  const start = Date.now();
  const payload = () =>
    JSON.stringify({
      pid: process.pid,
      at: Date.now(),
      host: os.hostname(),
      nonce: Math.random().toString(36).slice(2),
    });

  while (Date.now() - start < timeoutMs) {
    const body = payload();
    try {
      await claim(lp, body);
      return async function release() {
        await releaseIfOwner(lp, body);
      };
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
      if (await reclaimIfAbandoned(lp, staleMs)) continue;
      await sleep(20 + Math.floor(Math.random() * 40));
    }
  }
  throw new Error(`fabric lock timeout after ${timeoutMs}ms (${name})`);
}

/**
 * Publish a fully-written lockfile in one atomic step.
 *
 * open(lp, "wx") creates the file and the payload is written afterwards, so
 * between those two awaits the lock exists and is EMPTY — and a concurrent
 * acquirer that read it in that window took an empty string for a dead owner
 * and stole a live lock. link() is atomic: it fails EEXIST when the lock is
 * held, and what it publishes already carries the owner payload, so a lock is
 * never observable mid-creation.
 */
async function claim(lp, body) {
  const tmp = `${lp}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, body, { flag: "wx" });
  try {
    await fs.link(tmp, lp);
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

/**
 * Unlink the lock only while it is still the one we took. A release that
 * unlinks the path unconditionally deletes whatever is there — including a
 * lock another holder has since taken.
 */
async function releaseIfOwner(lp, body) {
  try {
    if ((await fs.readFile(lp, "utf8")) !== body) return;
  } catch {
    return;
  }
  await fs.unlink(lp).catch(() => {});
}

/**
 * True when the held lock was cleared and the claim is worth retrying now.
 *
 * Reclaim needs evidence: a pid we can read and prove gone, or an age past
 * the stale window. A lock we cannot read is not evidence of anything — the
 * old code unlinked on any read failure and parsed an empty file as pid 0.
 */
async function reclaimIfAbandoned(lp, staleMs) {
  let raw;
  try {
    raw = await fs.readFile(lp, "utf8");
  } catch {
    // A lock we cannot read is not evidence that its owner died. Wait.
    return false;
  }
  let meta = null;
  try {
    meta = JSON.parse(raw);
  } catch {
    // Tolerate the bare-pid lockfile format; an empty file names no owner.
    const n = Number(String(raw).trim());
    if (String(raw).trim() && Number.isFinite(n)) meta = { pid: n };
  }
  const pid = Number(meta?.pid);
  if (meta && Number.isFinite(pid) && !isPidAlive(pid)) {
    await fs.unlink(lp).catch(() => {});
    return true;
  }
  let at = Number(meta?.at);
  if (!Number.isFinite(at) || at <= 0) {
    at = await fs
      .stat(lp)
      .then((st) => st.mtimeMs)
      .catch(() => Date.now());
  }
  if (Date.now() - at > staleMs * 3) {
    await fs.unlink(lp).catch(() => {});
    return true;
  }
  return false;
}

/**
 * Run fn under exclusive fabric lock.
 */
export async function withFabricLock(fn, opts = {}) {
  const release = await acquireFabricLock(opts);
  try {
    return await fn();
  } finally {
    await release();
  }
}

export function fabricLockPath(name = "fabric") {
  return lockPath(name);
}

export default { acquireFabricLock, withFabricLock, fabricLockPath };
