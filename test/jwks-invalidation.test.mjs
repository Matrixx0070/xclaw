import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ensureKeyStore, rotateKeys } from "../src/auth/key-rotation.mjs";
import {
  getJwksCached,
  invalidateJwksCache,
} from "../src/auth/jwks.mjs";
import {
  publishJwksInvalidation,
  checkJwksInvalidation,
  applyRemoteInvalidation,
  getInvalidationEpoch,
  onJwksInvalidation,
} from "../src/auth/jwks-invalidation.mjs";

describe("distributed JWKS invalidation", () => {
  async function tmpCfg() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-jinv-"));
    return {
      paths: { configDir: dir },
      auth: {
        keys: {
          secret: "inv-test-secret!!!!!",
          rotationStrategy: "dual_slot",
          dualWindowMs: 60_000,
          autoRotate: false,
        },
        jwks: {
          cacheStrategy: "hybrid",
          cacheTtlMs: 3_600_000,
          maxStaleMs: 3_600_000,
          distributedInvalidation: true,
        },
      },
    };
  }

  it("publish advances epoch", async () => {
    const cfg = await tmpCfg();
    const a = await publishJwksInvalidation(cfg, { reason: "test" });
    assert.equal(a.ok, true);
    assert.equal(a.epoch, 1);
    const b = await publishJwksInvalidation(cfg, { reason: "test2" });
    assert.equal(b.epoch, 2);
  });

  it("check detects stale cache after publish", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    await invalidateJwksCache(cfg);
    const cached = await getJwksCached(cfg);
    assert.ok(cached.ok);
    await publishJwksInvalidation(cfg, {
      reason: "peer_rotate",
      generation: 99,
    });
    // re-read cache file as getJwksCached would
    const cachePath = path.join(cfg.paths.configDir, "jwks-cache.json");
    const cache = JSON.parse(await fs.readFile(cachePath, "utf8"));
    const chk = await checkJwksInvalidation(cfg, cache);
    assert.equal(chk.stale, true);
    assert.equal(chk.reason, "epoch_advanced");
  });

  it("getJwksCached refreshes after distributed invalidation", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    await invalidateJwksCache(cfg);
    const first = await getJwksCached(cfg);
    assert.ok(first.cache === "miss" || first.cache === "refresh");
    const second = await getJwksCached(cfg);
    assert.equal(second.cache, "hit");

    await publishJwksInvalidation(cfg, { reason: "remote" });
    const third = await getJwksCached(cfg);
    assert.ok(
      third.cache === "refresh" || third.reason === "epoch_advanced" || third.ok
    );
    // should not be a plain hit without refresh reason
    if (third.cache === "hit") {
      assert.fail("expected refresh after invalidation");
    }
  });

  it("applyRemoteInvalidation converges epoch", async () => {
    const cfg = await tmpCfg();
    const r = await applyRemoteInvalidation(cfg, {
      type: "jwks_invalidation",
      epoch: 5,
      reason: "peer",
      generation: 3,
    });
    assert.equal(r.applied, true);
    const ep = await getInvalidationEpoch(cfg);
    assert.equal(ep.epoch, 5);
  });

  it("onJwksInvalidation listener fires", async () => {
    const cfg = await tmpCfg();
    let seen = null;
    const off = onJwksInvalidation((doc) => {
      seen = doc;
    });
    await publishJwksInvalidation(cfg, { reason: "listener_test" });
    off();
    assert.ok(seen);
    assert.equal(seen.reason, "listener_test");
  });

  it("rotate publishes invalidation", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    await rotateKeys(cfg, { reason: "test_rotate" });
    const ep = await getInvalidationEpoch(cfg);
    assert.ok(ep.epoch >= 1);
  });
});
