/**
 * Distributed JWKS cache invalidation.
 *
 * Mechanisms (can combine):
 *   1. epoch file  — shared invalidation epoch on local/shared FS
 *                    (multi-process, multi-host with shared volume)
 *   2. generation  — bind cache to key-rotation generation; mismatch → refresh
 *   3. webhook     — POST invalidation event to peer URLs
 *   4. listeners   — in-process EventEmitter-style callbacks
 *
 * On rotate / compromise recovery, call publishJwksInvalidation().
 * On getJwksCached, call checkJwksInvalidation() — if epoch advanced, force refresh.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  durableAtomicWriteJson,
  durableWritesEnabled,
} from "../utils/durable-write.mjs";

function paths(cfg = {}) {
  const configDir =
    cfg.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR ||
    path.join(os.homedir(), ".xclaw");
  return {
    configDir,
    epochPath:
      cfg.auth?.jwks?.invalidationEpochPath ||
      path.join(configDir, "jwks-invalidation-epoch.json"),
  };
}

function invPolicy(cfg = {}) {
  const j = cfg.auth?.jwks || {};
  return {
    enabled: j.distributedInvalidation !== false,
    /** Peer URLs that accept POST { epoch, generation, kid, reason, etag } */
    webhookUrls: Array.isArray(j.invalidationWebhooks)
      ? j.invalidationWebhooks
      : (process.env.XCLAW_JWKS_INVALIDATION_WEBHOOKS || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
    webhookTimeoutMs:
      Number(j.invalidationWebhookTimeoutMs) > 0
        ? Number(j.invalidationWebhookTimeoutMs)
        : 3_000,
  };
}

const localListeners = new Set();

/**
 * Subscribe to in-process invalidation events.
 * @returns {() => void} unsubscribe
 */
export function onJwksInvalidation(fn) {
  localListeners.add(fn);
  return () => localListeners.delete(fn);
}

async function readEpoch(cfg) {
  try {
    return JSON.parse(await fs.readFile(paths(cfg).epochPath, "utf8"));
  } catch {
    return {
      version: 1,
      epoch: 0,
      updatedAt: 0,
      reason: null,
      generation: null,
      kid: null,
      etag: null,
      id: null,
    };
  }
}

async function writeEpoch(cfg, epochDoc) {
  const p = paths(cfg).epochPath;
  await durableAtomicWriteJson(p, epochDoc, {
    durable: durableWritesEnabled(cfg),
    mode: 0o600,
    dirMode: 0o700,
  });
}

/**
 * Publish invalidation to epoch file, local listeners, and optional webhooks.
 */
export async function publishJwksInvalidation(cfg = {}, event = {}) {
  const pol = invPolicy(cfg);
  if (!pol.enabled) {
    return { ok: true, skipped: true, reason: "disabled" };
  }

  const prev = await readEpoch(cfg);
  const nextEpoch = (prev.epoch || 0) + 1;
  const doc = {
    version: 1,
    epoch: nextEpoch,
    updatedAt: Date.now(),
    reason: event.reason || "manual",
    generation: event.generation ?? prev.generation,
    kid: event.kid ?? null,
    etag: event.etag ?? null,
    id: crypto.randomBytes(8).toString("hex"),
    publisher: event.publisher || `pid:${process.pid}`,
  };
  await writeEpoch(cfg, doc);

  const listenerErrors = [];
  for (const fn of localListeners) {
    try {
      await fn(doc);
    } catch (e) {
      listenerErrors.push(e.message || String(e));
    }
  }

  const webhookResults = [];
  for (const url of pol.webhookUrls) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), pol.webhookTimeoutMs);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "jwks_invalidation",
          ...doc,
        }),
        signal: ac.signal,
      });
      clearTimeout(t);
      webhookResults.push({ url, ok: res.ok, status: res.status });
    } catch (e) {
      webhookResults.push({
        url,
        ok: false,
        error: e.message || String(e),
      });
    }
  }

  let redis = { skipped: true };
  try {
    const { publishJwksInvalidationRedis } = await import(
      "./jwks-redis-pubsub.mjs"
    );
    redis = await publishJwksInvalidationRedis(cfg, doc);
  } catch (e) {
    redis = { ok: false, error: e.message || String(e) };
  }

  return {
    ok: true,
    epoch: nextEpoch,
    id: doc.id,
    reason: doc.reason,
    listeners: localListeners.size,
    listenerErrors,
    webhooks: webhookResults,
    redis,
  };
}

/**
 * Compare local cache against shared epoch + key generation.
 * @returns {{ stale: boolean, reason?: string, epoch?: number, cacheEpoch?: number }}
 */
export async function checkJwksInvalidation(cfg = {}, cache = null) {
  const pol = invPolicy(cfg);
  if (!pol.enabled) {
    return { stale: false, reason: "disabled" };
  }

  const epochDoc = await readEpoch(cfg);
  const cacheEpoch = cache?.invalidationEpoch ?? cache?.epoch ?? 0;

  if ((epochDoc.epoch || 0) > cacheEpoch) {
    return {
      stale: true,
      reason: "epoch_advanced",
      epoch: epochDoc.epoch,
      cacheEpoch,
      generation: epochDoc.generation,
      kid: epochDoc.kid,
    };
  }

  // Generation binding: if cache has generation and it is behind event generation
  if (
    cache?.generation != null &&
    epochDoc.generation != null &&
    Number(epochDoc.generation) > Number(cache.generation) &&
    (epochDoc.epoch || 0) >= cacheEpoch
  ) {
    // epoch already compared; generation mismatch with same epoch is odd but force refresh
    if (Number(epochDoc.generation) !== Number(cache.generation)) {
      return {
        stale: true,
        reason: "generation_mismatch",
        epoch: epochDoc.epoch,
        cacheGeneration: cache.generation,
        generation: epochDoc.generation,
      };
    }
  }

  return {
    stale: false,
    reason: "current",
    epoch: epochDoc.epoch || 0,
    cacheEpoch,
  };
}

export async function getInvalidationEpoch(cfg = {}) {
  return readEpoch(cfg);
}

/**
 * Apply remote invalidation payload (from webhook peer).
 * Advances local epoch to max(local, remote) so all nodes converge.
 */
export async function applyRemoteInvalidation(cfg = {}, payload = {}) {
  // Idempotent: retries / double delivery of same event apply once
  const { withIdempotency, idempotencyKeyFromEvent } = await import(
    "./idempotency.mjs"
  );
  const key = idempotencyKeyFromEvent(
    {
      id: payload.id,
      type: payload.type || "jwks_invalidation",
      epoch: payload.epoch,
      generation: payload.generation,
      kid: payload.kid,
      reason: payload.reason,
    },
    "jwks-inv"
  );

  return withIdempotency(
    cfg,
    key,
    async () => {
      const remoteEpoch = Number(payload.epoch) || 0;
      const local = await readEpoch(cfg);
      if (remoteEpoch <= (local.epoch || 0)) {
        return {
          ok: true,
          applied: false,
          reason: "local_epoch_newer_or_equal",
          epoch: local.epoch,
        };
      }
      const doc = {
        version: 1,
        epoch: remoteEpoch,
        updatedAt: Date.now(),
        reason: payload.reason || "remote_webhook",
        generation: payload.generation ?? null,
        kid: payload.kid ?? null,
        etag: payload.etag ?? null,
        id: payload.id || crypto.randomBytes(8).toString("hex"),
        publisher: payload.publisher || "remote",
        remote: true,
      };
      await writeEpoch(cfg, doc);
      for (const fn of localListeners) {
        try {
          await fn(doc);
        } catch {
          /* */
        }
      }
      return { ok: true, applied: true, epoch: remoteEpoch };
    },
    {
      request: {
        epoch: payload.epoch,
        generation: payload.generation,
        kid: payload.kid,
      },
    }
  );
}

/**
 * HTTP handler helper for gateway:
 *   POST /xclaw/jwks/invalidate  — publish or apply
 *   GET  /xclaw/jwks/invalidation-epoch
 */
export async function handleInvalidationHttp(cfg, method, body = null) {
  if (method === "GET") {
    return {
      status: 200,
      body: await getInvalidationEpoch(cfg),
    };
  }
  if (method === "POST") {
    if (body && body.epoch && body.remote !== false && body.type === "jwks_invalidation") {
      const r = await applyRemoteInvalidation(cfg, body);
      return { status: 200, body: r };
    }
    const r = await publishJwksInvalidation(cfg, body || { reason: "http" });
    return { status: 200, body: r };
  }
  return { status: 405, body: { error: "method not allowed" } };
}
