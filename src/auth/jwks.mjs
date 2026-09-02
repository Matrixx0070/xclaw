/**
 * JWKS export + caching strategy for XClaw verification keys.
 *
 * Export: current (+ dual-window previous) public JWKs as RFC 7517 JWKS.
 * Cache: TTL, stale-while-revalidate, forced refresh on unknown kid,
 *        ETag/version binding to key generation.
 *
 * Strategies:
 *   ttl              — refresh when age >= cacheTtlMs
 *   unknown_kid      — refresh immediately when kid not in cache
 *   stale_revalidate — serve stale up to maxStaleMs while refreshing
 *   hybrid (default) — unknown_kid + ttl + soft stale window
 *
 * `paths()` honours `cfg.auth?.jwks?.cachePath` then `paths.configDir`
 * then `XCLAW_CONFIG_DIR` then null. No home fallback. Do not honour
 * `XCLAW_STATE_DIR`. A cfg without configDir is never a real caller
 * (`loadConfig()` stamps it unconditionally). `writeCache` still no-ops
 * without persisting (do not call durableAtomicWriteJson on null — that
 * helper `mkdir`s dirname). `readCache` returns null (same as missing).
 * Keep `cfg.auth?.jwks?.cachePath`. Keep `XCLAW_JWKS_CACHE` as strategy
 * env (not path).
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  ensureKeyStore,
  getVerificationKeys,
  keyRotationStatus,
} from "./key-rotation.mjs";
import { isRevoked } from "./key-compromise-recovery.mjs";
import {
  checkJwksInvalidation,
  publishJwksInvalidation,
  getInvalidationEpoch,
} from "./jwks-invalidation.mjs";
import {
  durableAtomicWriteJson,
  durableWritesEnabled,
} from "../utils/durable-write.mjs";

export const JWKS_CACHE_STRATEGIES = {
  ttl: { id: "ttl", description: "Refresh when cache age >= cacheTtlMs" },
  unknown_kid: {
    id: "unknown_kid",
    description: "Refresh when requested kid missing from cache",
  },
  stale_revalidate: {
    id: "stale_revalidate",
    description: "Serve stale up to maxStaleMs while background refresh",
  },
  hybrid: {
    id: "hybrid",
    description: "unknown_kid + ttl + soft stale window (default)",
  },
};

function paths(cfg = {}) {
  const explicit = cfg.auth?.jwks?.cachePath;
  const configDir = cfg.paths?.configDir || process.env.XCLAW_CONFIG_DIR || null;
  return {
    configDir,
    cachePath:
      explicit ||
      (configDir ? path.join(configDir, "jwks-cache.json") : null),
  };
}

function jwksPolicy(cfg = {}) {
  const j = cfg.auth?.jwks || {};
  return {
    strategy: j.cacheStrategy || process.env.XCLAW_JWKS_CACHE || "hybrid",
    cacheTtlMs: Number(j.cacheTtlMs) > 0 ? Number(j.cacheTtlMs) : 5 * 60 * 1000,
    maxStaleMs:
      Number(j.maxStaleMs) > 0 ? Number(j.maxStaleMs) : 30 * 60 * 1000,
    /** Exclude revoked kids from exported JWKS when recovery module available */
    filterRevoked: j.filterRevoked !== false,
  };
}

/**
 * Build public JWK entry for JWKS (never include private fields).
 */
export function toPublicJwkEntry(key) {
  const jwk = { ...(key.publicJwk || key) };
  delete jwk.d;
  delete jwk.p;
  delete jwk.q;
  delete jwk.dp;
  delete jwk.dq;
  delete jwk.qi;
  delete jwk.oth;
  if (key.kid) jwk.kid = key.kid;
  if (!jwk.use) jwk.use = "sig";
  if (!jwk.alg && jwk.kty === "EC" && jwk.crv === "P-256") jwk.alg = "ES256";
  return jwk;
}

/**
 * Export live verification keys as JWKS document.
 */
export async function exportJwks(cfg = {}) {
  await ensureKeyStore(cfg);
  const keys = await getVerificationKeys(cfg);
  const pol = jwksPolicy(cfg);
  const out = [];

  for (const k of keys) {
    if (pol.filterRevoked) {
      try {
        if (await isRevoked(cfg, { kid: k.kid, generation: k.generation })) {
          continue;
        }
      } catch {
        /* recovery module optional failures — include key */
      }
    }
    out.push(
      toPublicJwkEntry({
        ...k,
        publicJwk: k.publicJwk,
        kid: k.kid,
      })
    );
  }

  const status = await keyRotationStatus(cfg);
  const jwks = { keys: out };
  const body = JSON.stringify(jwks);
  const etag = crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);

  return {
    jwks,
    etag,
    generation: status.generation,
    kid: status.kid,
    dualWindowOpen: Boolean(status.dualWindow?.open),
    exportedAt: Date.now(),
    keyCount: out.length,
  };
}

async function readCache(cfg) {
  const p = paths(cfg).cachePath;
  if (!p) return null;
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return null;
  }
}

async function writeCache(cfg, cache) {
  const p = paths(cfg).cachePath;
  if (!p) return;
  // JWKS cache is rebuildable — still atomic; durable optional via same policy
  await durableAtomicWriteJson(p, cache, {
    durable: durableWritesEnabled(cfg),
    mode: 0o600,
    dirMode: 0o700,
  });
}

/**
 * Decide whether cache must be refreshed.
 */
export function evaluateJwksCache(cache, pol, opts = {}) {
  const t = Date.now();
  if (!cache?.jwks?.keys) {
    return { action: "refresh", reason: "miss" };
  }

  const age = t - (cache.fetchedAt || 0);
  const strategy = pol.strategy || "hybrid";
  const kids = new Set((cache.jwks.keys || []).map((k) => k.kid).filter(Boolean));

  if (opts.force) {
    return { action: "refresh", reason: "force" };
  }

  // Distributed invalidation: shared epoch advanced past cache binding
  if (opts.invalidation?.stale) {
    return {
      action: "refresh",
      reason: opts.invalidation.reason || "distributed_invalidation",
      epoch: opts.invalidation.epoch,
    };
  }

  if (
    (strategy === "unknown_kid" || strategy === "hybrid") &&
    opts.kid &&
    !kids.has(opts.kid)
  ) {
    return { action: "refresh", reason: "unknown_kid", kid: opts.kid };
  }

  if (strategy === "ttl" || strategy === "hybrid") {
    if (age >= pol.cacheTtlMs) {
      if (
        strategy === "hybrid" &&
        age < pol.cacheTtlMs + pol.maxStaleMs
      ) {
        return {
          action: "stale_revalidate",
          reason: "ttl_soft",
          ageMs: age,
        };
      }
      return { action: "refresh", reason: "ttl_expired", ageMs: age };
    }
  }

  if (strategy === "stale_revalidate") {
    if (age >= pol.cacheTtlMs && age < pol.cacheTtlMs + pol.maxStaleMs) {
      return { action: "stale_revalidate", reason: "stale", ageMs: age };
    }
    if (age >= pol.cacheTtlMs + pol.maxStaleMs) {
      return { action: "refresh", reason: "max_stale", ageMs: age };
    }
  }

  return { action: "hit", reason: "fresh", ageMs: age };
}

/**
 * Local JWKS cache backed by exportJwks (same process / same store).
 * For remote JWKS, pass opts.fetcher = async () => ({ jwks, etag, ... }).
 */
export async function getJwksCached(cfg = {}, opts = {}) {
  const pol = jwksPolicy(cfg);
  let cache = await readCache(cfg);

  // Check shared invalidation epoch before TTL logic
  let invalidation = { stale: false };
  try {
    invalidation = await checkJwksInvalidation(cfg, cache);
  } catch {
    /* invalidation optional */
  }

  const decision = evaluateJwksCache(cache, pol, {
    ...opts,
    invalidation,
  });

  const doFetch = async () => {
    const epochDoc = await getInvalidationEpoch(cfg).catch(() => ({
      epoch: 0,
    }));
    if (typeof opts.fetcher === "function") {
      const remote = await opts.fetcher();
      return {
        jwks: remote.jwks,
        etag: remote.etag || null,
        generation: remote.generation,
        source: "remote",
        fetchedAt: Date.now(),
        strategy: pol.strategy,
        invalidationEpoch: epochDoc.epoch || 0,
      };
    }
    const exp = await exportJwks(cfg);
    return {
      jwks: exp.jwks,
      etag: exp.etag,
      generation: exp.generation,
      kid: exp.kid,
      dualWindowOpen: exp.dualWindowOpen,
      source: "local",
      fetchedAt: Date.now(),
      strategy: pol.strategy,
      invalidationEpoch: epochDoc.epoch || 0,
    };
  };

  if (decision.action === "hit") {
    return {
      ok: true,
      cache: "hit",
      reason: decision.reason,
      ageMs: decision.ageMs,
      jwks: cache.jwks,
      etag: cache.etag,
      generation: cache.generation,
    };
  }

  if (decision.action === "stale_revalidate" && cache?.jwks) {
    // Return stale immediately; refresh in background (awaited here for determinism in CLI/tests)
    const refreshed = await doFetch();
    await writeCache(cfg, refreshed);
    return {
      ok: true,
      cache: "revalidated",
      reason: decision.reason,
      ageMs: decision.ageMs,
      jwks: refreshed.jwks,
      etag: refreshed.etag,
      generation: refreshed.generation,
      previousEtag: cache.etag,
    };
  }

  // hard refresh
  const fresh = await doFetch();
  await writeCache(cfg, fresh);
  return {
    ok: true,
    cache: decision.reason === "miss" ? "miss" : "refresh",
    reason: decision.reason,
    jwks: fresh.jwks,
    etag: fresh.etag,
    generation: fresh.generation,
  };
}

/**
 * Find a key in JWKS by kid (uses cache strategy).
 */
export async function findJwkByKid(cfg, kid, opts = {}) {
  if (!kid) {
    return { ok: false, error: "kid required" };
  }
  const result = await getJwksCached(cfg, { ...opts, kid });
  const key = (result.jwks?.keys || []).find((k) => k.kid === kid);
  if (!key) {
    // One forced refresh if still missing
    if (!opts._retried) {
      return findJwkByKid(cfg, kid, { ...opts, force: true, _retried: true });
    }
    return {
      ok: false,
      error: "kid not found in JWKS",
      kid,
      cache: result.cache,
    };
  }
  return { ok: true, jwk: key, cache: result.cache, etag: result.etag };
}

/**
 * Invalidate local JWKS cache (e.g. after rotate / compromise).
 */
export async function invalidateJwksCache(cfg = {}) {
  const p = paths(cfg).cachePath;
  if (!p) return { ok: true, invalidated: true };
  try {
    await fs.unlink(p);
  } catch {
    /* already gone */
  }
  return { ok: true, invalidated: true };
}

/**
 * After key rotation or recovery — distribute invalidation, clear local, warm cache.
 */
export async function refreshJwksAfterRotation(cfg = {}, event = {}) {
  const inv = await publishJwksInvalidation(cfg, {
    reason: event.reason || "rotation",
    generation: event.generation,
    kid: event.kid,
    etag: event.etag,
  }).catch((e) => ({ ok: false, error: e.message }));
  await invalidateJwksCache(cfg);
  const cached = await getJwksCached(cfg, { force: true });
  return { ...cached, invalidation: inv };
}

export function listJwksCacheStrategies() {
  return Object.values(JWKS_CACHE_STRATEGIES);
}
