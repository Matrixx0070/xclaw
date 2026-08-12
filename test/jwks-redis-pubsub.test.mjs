import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ensureKeyStore } from "../src/auth/key-rotation.mjs";
import {
  publishJwksInvalidation,
  getInvalidationEpoch,
} from "../src/auth/jwks-invalidation.mjs";
import {
  createMemoryRedisMock,
  publishJwksInvalidationRedis,
  startJwksRedisSubscriber,
  stopJwksRedisSubscriber,
  closeJwksRedisPublisher,
  jwksRedisStatus,
} from "../src/auth/jwks-redis-pubsub.mjs";

describe("JWKS Redis Pub/Sub transport", () => {
  after(async () => {
    await stopJwksRedisSubscriber();
    await closeJwksRedisPublisher();
  });

  async function tmpCfg(client) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-redis-"));
    return {
      paths: { configDir: dir },
      auth: {
        durableWrites: false, // faster tests
        keys: {
          secret: "redis-test-secret!!!!",
          autoRotate: false,
        },
        jwks: {
          distributedInvalidation: true,
          redis: {
            enabled: true,
            client,
            channel: "xclaw:test:jwks",
          },
        },
      },
    };
  }

  it("publish reaches subscriber via memory mock", async () => {
    const bus = createMemoryRedisMock();
    const cfg = await tmpCfg(bus);
    await ensureKeyStore(cfg);

    const seen = [];
    await startJwksRedisSubscriber(cfg, {
      onMessage: (p) => seen.push(p),
    });

    const pub = await publishJwksInvalidation(cfg, {
      reason: "redis_test",
      generation: 2,
    });
    assert.equal(pub.ok, true);
    assert.ok(pub.redis?.ok !== false);

    // allow async handler
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(seen.length >= 1);
    assert.equal(seen[0].type, "jwks_invalidation");
    assert.ok(seen[0].epoch >= 1);

    const ep = await getInvalidationEpoch(cfg);
    assert.ok(ep.epoch >= 1);
  });

  it("status reports injected client", async () => {
    const bus = createMemoryRedisMock();
    const cfg = await tmpCfg(bus);
    const st = jwksRedisStatus(cfg);
    assert.equal(st.enabled, true);
    assert.equal(st.channel, "xclaw:test:jwks");
  });

  it("publishJwksInvalidationRedis direct", async () => {
    const bus = createMemoryRedisMock();
    const cfg = await tmpCfg(bus);
    let got = null;
    await bus.subscribe("xclaw:test:jwks", (msg) => {
      got = JSON.parse(msg);
    });
    const r = await publishJwksInvalidationRedis(cfg, {
      epoch: 9,
      id: "abc",
      reason: "direct",
    });
    assert.equal(r.ok, true);
    assert.equal(got.epoch, 9);
  });
});
