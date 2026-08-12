/**
 * Idempotency keys for XClaw mutating operations.
 *
 * Guarantees (single process / shared store file):
 *   - First begin(key) wins; concurrent begin with same key waits or attaches
 *   - complete(key, result) stores response for replay within TTL
 *   - fail(key) releases so a retry may run again (or stores failure if policy says)
 *
 * Strategies:
 *   in_progress_reject  — second call while running → 409-style error
 *   in_progress_wait    — wait for first to finish, return same result
 *   replay_only         — if completed, return stored; if in progress, reject
 *
 * Storage: ~/.xclaw/idempotency.json (0600) — pluggable via cfg.auth.idempotency
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  durableAtomicWriteJson,
  durableWritesEnabled,
} from "../utils/durable-write.mjs";

export class IdempotencyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "IdempotencyError";
    this.code = code;
    this.details = details;
  }
}

function paths(cfg = {}) {
  const configDir =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  return {
    configDir,
    storePath:
      cfg.auth?.idempotency?.storePath ||
      path.join(configDir, "idempotency.json"),
  };
}

function policy(cfg = {}) {
  const i = cfg.auth?.idempotency || {};
  return {
    /** How long to retain completed results for replay */
    ttlMs: Number(i.ttlMs) > 0 ? Number(i.ttlMs) : 24 * 3600 * 1000,
    /** Max records before opportunistic prune */
    maxRecords: Number(i.maxRecords) > 0 ? Number(i.maxRecords) : 5_000,
    /** Concurrent same-key behavior */
    onInProgress:
      i.onInProgress ||
      process.env.XCLAW_IDEMPOTENCY_ON_IN_PROGRESS ||
      "reject", // reject | wait
    /** Wait timeout when onInProgress=wait */
    waitTimeoutMs:
      Number(i.waitTimeoutMs) > 0 ? Number(i.waitTimeoutMs) : 30_000,
    waitPollMs: Number(i.waitPollMs) > 0 ? Number(i.waitPollMs) : 50,
    /** Hash request fingerprint into record for mismatch detection */
    bindFingerprint: i.bindFingerprint !== false,
  };
}

function now() {
  return Date.now();
}

function normalizeKey(key) {
  if (key == null || String(key).trim() === "") {
    throw new IdempotencyError("MISSING_KEY", "idempotency key required");
  }
  const k = String(key).trim();
  if (k.length > 256) {
    throw new IdempotencyError(
      "INVALID_KEY",
      "idempotency key max length 256"
    );
  }
  return k;
}

/**
 * Stable fingerprint of request payload (optional binding).
 */
export function requestFingerprint(parts = {}) {
  const json = JSON.stringify(parts, Object.keys(parts).sort());
  return crypto.createHash("sha256").update(json).digest("hex").slice(0, 32);
}

async function readStore(cfg) {
  try {
    return JSON.parse(await fs.readFile(paths(cfg).storePath, "utf8"));
  } catch {
    return { version: 1, records: {} };
  }
}

async function writeStore(cfg, store) {
  const p = paths(cfg).storePath;
  await durableAtomicWriteJson(p, store, {
    durable: durableWritesEnabled(cfg),
    mode: 0o600,
    dirMode: 0o700,
  });
}

function prune(store, pol, t = now()) {
  const recs = store.records || {};
  for (const [k, r] of Object.entries(recs)) {
    if (r.expiresAt && r.expiresAt < t) delete recs[k];
    if (r.status === "in_progress" && r.startedAt < t - pol.ttlMs) {
      // abandoned lock
      delete recs[k];
    }
  }
  const keys = Object.keys(recs);
  if (keys.length > pol.maxRecords) {
    keys
      .map((k) => ({ k, t: recs[k].completedAt || recs[k].startedAt || 0 }))
      .sort((a, b) => a.t - b.t)
      .slice(0, keys.length - pol.maxRecords)
      .forEach(({ k }) => delete recs[k]);
  }
  store.records = recs;
}

/**
 * Begin an idempotent operation.
 * @returns {{ fresh: true } | { fresh: false, replay: true, result }}
 */
export async function beginIdempotent(cfg, key, opts = {}) {
  const pol = policy(cfg);
  const id = normalizeKey(key);
  const fp =
    opts.fingerprint ||
    (opts.request != null && pol.bindFingerprint
      ? requestFingerprint(opts.request)
      : null);

  const t = now();
  let store = await readStore(cfg);
  prune(store, pol, t);

  let rec = store.records[id];

  if (rec?.status === "completed" && (!rec.expiresAt || rec.expiresAt > t)) {
    if (fp && rec.fingerprint && rec.fingerprint !== fp) {
      throw new IdempotencyError(
        "FINGERPRINT_MISMATCH",
        "idempotency key reused with different request fingerprint",
        { key: id }
      );
    }
    return {
      fresh: false,
      replay: true,
      result: rec.result,
      key: id,
      completedAt: rec.completedAt,
    };
  }

  if (rec?.status === "failed" && rec.expiresAt > t && opts.replayFailures) {
    return {
      fresh: false,
      replay: true,
      result: rec.result,
      failed: true,
      key: id,
    };
  }

  if (rec?.status === "in_progress") {
    if (fp && rec.fingerprint && rec.fingerprint !== fp) {
      throw new IdempotencyError(
        "FINGERPRINT_MISMATCH",
        "idempotency key in progress with different fingerprint",
        { key: id }
      );
    }
    if (pol.onInProgress === "wait" || opts.wait) {
      return waitForCompletion(cfg, id, pol, fp);
    }
    throw new IdempotencyError(
      "IN_PROGRESS",
      "operation with this idempotency key is already in progress",
      { key: id, startedAt: rec.startedAt }
    );
  }

  // claim
  store.records[id] = {
    status: "in_progress",
    startedAt: t,
    expiresAt: t + pol.ttlMs,
    fingerprint: fp,
    owner: opts.owner || `pid:${process.pid}`,
  };
  await writeStore(cfg, store);

  // simple race check: re-read
  store = await readStore(cfg);
  rec = store.records[id];
  if (rec?.owner && opts.owner && rec.owner !== opts.owner && rec.status === "in_progress") {
    // lost race
    if (pol.onInProgress === "wait" || opts.wait) {
      return waitForCompletion(cfg, id, pol, fp);
    }
    throw new IdempotencyError("IN_PROGRESS", "lost idempotency race", {
      key: id,
    });
  }

  return { fresh: true, replay: false, key: id, fingerprint: fp };
}

async function waitForCompletion(cfg, id, pol, fp) {
  const deadline = now() + pol.waitTimeoutMs;
  while (now() < deadline) {
    await new Promise((r) => setTimeout(r, pol.waitPollMs));
    const store = await readStore(cfg);
    const rec = store.records[id];
    if (!rec) {
      throw new IdempotencyError(
        "LOST",
        "idempotency record disappeared while waiting",
        { key: id }
      );
    }
    if (rec.status === "completed") {
      if (fp && rec.fingerprint && rec.fingerprint !== fp) {
        throw new IdempotencyError("FINGERPRINT_MISMATCH", "fingerprint mismatch after wait", {
          key: id,
        });
      }
      return {
        fresh: false,
        replay: true,
        result: rec.result,
        key: id,
        waited: true,
      };
    }
    if (rec.status === "failed") {
      throw new IdempotencyError(
        "PRIOR_FAILURE",
        "prior attempt failed",
        { key: id, result: rec.result }
      );
    }
  }
  throw new IdempotencyError(
    "WAIT_TIMEOUT",
    "timed out waiting for in-progress idempotent operation",
    { key: id }
  );
}

/**
 * Mark success and store result for replay.
 */
export async function completeIdempotent(cfg, key, result) {
  const id = normalizeKey(key);
  const pol = policy(cfg);
  const t = now();
  const store = await readStore(cfg);
  const rec = store.records[id] || {
    startedAt: t,
    fingerprint: null,
  };
  rec.status = "completed";
  rec.completedAt = t;
  rec.expiresAt = t + pol.ttlMs;
  rec.result = result;
  store.records[id] = rec;
  prune(store, pol, t);
  await writeStore(cfg, store);
  return { ok: true, key: id };
}

/**
 * Mark failure. By default allows retry (deletes in_progress).
 * opts.storeFailure=true keeps failure for replay.
 */
export async function failIdempotent(cfg, key, error, opts = {}) {
  const id = normalizeKey(key);
  const pol = policy(cfg);
  const t = now();
  const store = await readStore(cfg);
  if (opts.storeFailure) {
    store.records[id] = {
      ...(store.records[id] || {}),
      status: "failed",
      completedAt: t,
      expiresAt: t + pol.ttlMs,
      result: {
        ok: false,
        error: error?.message || String(error),
        code: error?.code,
      },
    };
  } else {
    delete store.records[id];
  }
  await writeStore(cfg, store);
  return { ok: true, key: id, stored: Boolean(opts.storeFailure) };
}

/**
 * Run fn exactly once per key (within TTL); replays stored result.
 */
export async function withIdempotency(cfg, key, fn, opts = {}) {
  const begin = await beginIdempotent(cfg, key, opts);
  if (!begin.fresh) {
    return {
      ...begin.result,
      _idempotent: true,
      _replay: true,
      _key: begin.key,
    };
  }
  try {
    const result = await fn();
    await completeIdempotent(cfg, begin.key, result);
    return {
      ...result,
      _idempotent: true,
      _replay: false,
      _key: begin.key,
    };
  } catch (e) {
    await failIdempotent(cfg, begin.key, e, {
      storeFailure: opts.storeFailure,
    });
    throw e;
  }
}

/**
 * Helper for JWKS / recovery events: key from event id or hash of payload.
 */
export function idempotencyKeyFromEvent(event = {}, prefix = "evt") {
  if (event.id) return `${prefix}:${event.id}`;
  if (event.idempotencyKey) return String(event.idempotencyKey);
  const fp = requestFingerprint({
    type: event.type,
    epoch: event.epoch,
    generation: event.generation,
    kid: event.kid,
    reason: event.reason,
  });
  return `${prefix}:${fp}`;
}

export async function idempotencyStatus(cfg = {}) {
  const pol = policy(cfg);
  const store = await readStore(cfg);
  prune(store, pol);
  const records = store.records || {};
  const byStatus = { in_progress: 0, completed: 0, failed: 0 };
  for (const r of Object.values(records)) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  }
  return {
    count: Object.keys(records).length,
    byStatus,
    ttlMs: pol.ttlMs,
    onInProgress: pol.onInProgress,
  };
}

export async function clearIdempotencyStore(cfg = {}) {
  const p = paths(cfg).storePath;
  try {
    await fs.unlink(p);
  } catch {
    /* */
  }
  return { ok: true };
}
