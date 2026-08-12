/**
 * Optional Redis Pub/Sub transport for JWKS distributed invalidation.
 *
 * Channel default: xclaw:jwks:invalidate
 *
 * Requires optional dependency `redis` (node-redis v4+):
 *   npm install redis
 *
 * Or inject a compatible client:
 *   cfg.auth.jwks.redis.client = { publish, duplicate, connect, ... }
 *
 * Design:
 *   - Epoch file remains source of truth
 *   - Redis is a fast fan-out so live nodes refresh before TTL
 *   - Missed messages are safe (epoch check on getJwksCached)
 */
import {
  applyRemoteInvalidation,
} from "./jwks-invalidation.mjs";

const DEFAULT_CHANNEL = "xclaw:jwks:invalidate";

function redisPolicy(cfg = {}) {
  const r = cfg.auth?.jwks?.redis || {};
  return {
    enabled: r.enabled === true || process.env.XCLAW_JWKS_REDIS === "1",
    url:
      r.url ||
      process.env.XCLAW_REDIS_URL ||
      process.env.REDIS_URL ||
      "redis://127.0.0.1:6379",
    channel: r.channel || process.env.XCLAW_JWKS_REDIS_CHANNEL || DEFAULT_CHANNEL,
    connectTimeoutMs: Number(r.connectTimeoutMs) > 0 ? Number(r.connectTimeoutMs) : 3_000,
    /** Injected client (tests / custom) */
    client: r.client || null,
  };
}

let sharedPublisher = null;
let sharedSubscriber = null;
let subscriberRunning = false;
let subscriberCfgRef = null;

/**
 * Create or return a redis client. Uses dynamic import so redis is optional.
 */
export async function createRedisClient(cfg = {}, opts = {}) {
  const pol = redisPolicy(cfg);
  if (pol.client) {
    const c = pol.client;
    if (typeof c.connect === "function" && !c.isOpen && !opts.skipConnect) {
      try {
        await c.connect();
      } catch {
        /* already connected or mock */
      }
    }
    return c;
  }

  let createClient;
  try {
    ({ createClient } = await import("redis"));
  } catch (e) {
    const err = new Error(
      'Redis package not installed. Run: npm install redis  (or set auth.jwks.redis.client)'
    );
    err.code = "REDIS_NOT_INSTALLED";
    err.cause = e;
    throw err;
  }

  const client = createClient({
    url: pol.url,
    socket: {
      connectTimeout: pol.connectTimeoutMs,
      reconnectStrategy: opts.subscriber
        ? (retries) => Math.min(1000 * 2 ** retries, 15_000)
        : false,
    },
  });

  client.on("error", (err) => {
    if (opts.onError) opts.onError(err);
  });

  await client.connect();
  return client;
}

/**
 * Publish invalidation payload to Redis channel.
 * Best-effort: failures are returned, not thrown (epoch file already written).
 */
export async function publishJwksInvalidationRedis(cfg = {}, doc = {}) {
  const pol = redisPolicy(cfg);
  if (!pol.enabled && !pol.client) {
    return { ok: true, skipped: true, reason: "redis_disabled" };
  }

  try {
    // Prefer injected client from cfg so tests/multi-tenant don't share a stale bus
    let publisher = pol.client || sharedPublisher;
    if (!publisher) {
      publisher = await createRedisClient(cfg, { onError: () => {} });
      sharedPublisher = publisher;
    } else if (pol.client) {
      publisher = pol.client;
      if (typeof publisher.connect === "function" && !publisher.isOpen) {
        try {
          await publisher.connect();
        } catch {
          /* */
        }
      }
    }
    const payload = JSON.stringify({
      type: "jwks_invalidation",
      epoch: doc.epoch,
      generation: doc.generation ?? null,
      kid: doc.kid ?? null,
      etag: doc.etag ?? null,
      id: doc.id ?? null,
      reason: doc.reason || "redis",
      publisher: doc.publisher || `redis-pub:${process.pid}`,
      updatedAt: doc.updatedAt || Date.now(),
    });
    const n = await publisher.publish(pol.channel, payload);
    return {
      ok: true,
      channel: pol.channel,
      subscribers: typeof n === "number" ? n : null,
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message || String(e),
      code: e.code,
    };
  }
}

/**
 * Start a long-lived subscriber that applies remote invalidation + busts JWKS cache.
 * Call once per process (gateway boot).
 */
export async function startJwksRedisSubscriber(cfg = {}, opts = {}) {
  const pol = redisPolicy(cfg);
  if (!pol.enabled && !pol.client) {
    return { ok: true, skipped: true, reason: "redis_disabled" };
  }
  if (subscriberRunning) {
    return { ok: true, alreadyRunning: true, channel: pol.channel };
  }

  const onMessage = opts.onMessage;
  const invalidateLocal =
    opts.invalidateLocal ||
    (async () => {
      try {
        const { invalidateJwksCache } = await import("./jwks.mjs");
        await invalidateJwksCache(cfg);
      } catch {
        /* */
      }
    });

  let sub;
  if (pol.client && typeof pol.client.duplicate === "function") {
    sub = pol.client.duplicate();
    if (typeof sub.connect === "function") {
      try {
        await sub.connect();
      } catch {
        /* mock */
      }
    }
  } else if (pol.client && typeof pol.client.subscribe === "function") {
    sub = pol.client;
  } else {
    sub = await createRedisClient(cfg, {
      subscriber: true,
      onError: (err) => {
        if (opts.onError) opts.onError(err);
      },
    });
  }

  const handler = async (message) => {
    let payload;
    try {
      payload = typeof message === "string" ? JSON.parse(message) : message;
    } catch {
      return;
    }
    if (onMessage) {
      try {
        await onMessage(payload);
      } catch {
        /* */
      }
    }
    try {
      await applyRemoteInvalidation(cfg, payload);
      await invalidateLocal();
    } catch {
      /* best-effort */
    }
  };

  // node-redis v4: subscribe(channel, listener)
  if (typeof sub.subscribe === "function") {
    await sub.subscribe(pol.channel, (message) => {
      handler(message).catch(() => {});
    });
  }

  sharedSubscriber = sub;
  subscriberRunning = true;
  subscriberCfgRef = cfg;

  return {
    ok: true,
    channel: pol.channel,
    running: true,
  };
}

export async function stopJwksRedisSubscriber() {
  subscriberRunning = false;
  if (sharedSubscriber) {
    try {
      if (typeof sharedSubscriber.unsubscribe === "function") {
        await sharedSubscriber.unsubscribe();
      }
      if (typeof sharedSubscriber.quit === "function") {
        await sharedSubscriber.quit();
      } else if (typeof sharedSubscriber.disconnect === "function") {
        await sharedSubscriber.disconnect();
      }
    } catch {
      /* */
    }
    sharedSubscriber = null;
  }
  return { ok: true, stopped: true };
}

export async function closeJwksRedisPublisher() {
  if (sharedPublisher) {
    try {
      if (typeof sharedPublisher.quit === "function") {
        await sharedPublisher.quit();
      } else if (typeof sharedPublisher.disconnect === "function") {
        await sharedPublisher.disconnect();
      }
    } catch {
      /* */
    }
    sharedPublisher = null;
  }
  return { ok: true };
}

export function jwksRedisStatus(cfg = {}) {
  const pol = redisPolicy(cfg);
  return {
    enabled: pol.enabled || Boolean(pol.client),
    url: pol.client ? "(injected client)" : pol.url,
    channel: pol.channel,
    publisherOpen: Boolean(sharedPublisher),
    subscriberRunning,
  };
}

/** Test helper: minimal in-memory pub/sub mock */
export function createMemoryRedisMock() {
  const channels = new Map(); // channel -> Set of handlers
  let open = true;

  const client = {
    isOpen: true,
    async connect() {
      open = true;
      this.isOpen = true;
    },
    async publish(channel, message) {
      const set = channels.get(channel) || new Set();
      for (const h of set) {
        try {
          h(message);
        } catch {
          /* */
        }
      }
      return set.size;
    },
    async subscribe(channel, listener) {
      if (!channels.has(channel)) channels.set(channel, new Set());
      channels.get(channel).add(listener);
    },
    async unsubscribe(channel) {
      if (channel) channels.delete(channel);
      else channels.clear();
    },
    async quit() {
      open = false;
      this.isOpen = false;
      channels.clear();
    },
    async disconnect() {
      return this.quit();
    },
    duplicate() {
      // same bus
      return client;
    },
    on() {
      return client;
    },
  };

  return client;
}
