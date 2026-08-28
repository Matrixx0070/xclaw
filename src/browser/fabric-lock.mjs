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
  const lp = lockPath(name, opts.root);
  const start = Date.now();
  const payload = () =>
    JSON.stringify({
      pid: process.pid,
      at: Date.now(),
      host: os.hostname(),
    });

  while (Date.now() - start < timeoutMs) {
    try {
      const fh = await fs.open(lp, "wx");
      await fh.writeFile(payload());
      await fh.close();
      return async function release() {
        try {
          await fs.unlink(lp);
        } catch {
          /* */
        }
      };
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
      // stale?
      try {
        const raw = await fs.readFile(lp, "utf8");
        let meta = {};
        try {
          meta = JSON.parse(raw);
        } catch {
          meta = { pid: Number(String(raw).trim()) };
        }
        const age = Date.now() - Number(meta.at || 0);
        const pid = Number(meta.pid);
        if (!isPidAlive(pid) || age > staleMs * 3) {
          await fs.unlink(lp).catch(() => {});
          continue;
        }
      } catch {
        await fs.unlink(lp).catch(() => {});
        continue;
      }
      await sleep(20 + Math.floor(Math.random() * 40));
    }
  }
  throw new Error(`fabric lock timeout after ${timeoutMs}ms (${name})`);
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
