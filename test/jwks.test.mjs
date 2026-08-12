import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ensureKeyStore, rotateKeys } from "../src/auth/key-rotation.mjs";
import {
  exportJwks,
  getJwksCached,
  evaluateJwksCache,
  invalidateJwksCache,
  findJwkByKid,
  refreshJwksAfterRotation,
  toPublicJwkEntry,
  listJwksCacheStrategies,
} from "../src/auth/jwks.mjs";

describe("JWKS caching strategy", () => {
  async function tmpCfg(extra = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-jwks-"));
    return {
      paths: { configDir: dir },
      auth: {
        keys: {
          secret: "jwks-test-secret!!!!",
          rotationStrategy: "dual_slot",
          dualWindowMs: 60_000,
          autoRotate: false,
        },
        jwks: {
          cacheStrategy: "hybrid",
          cacheTtlMs: 60_000,
          maxStaleMs: 30_000,
          ...extra,
        },
      },
    };
  }

  it("exportJwks includes current key without private fields", async () => {
    const cfg = await tmpCfg();
    const st = await ensureKeyStore(cfg);
    const exp = await exportJwks(cfg);
    assert.ok(exp.jwks.keys.length >= 1);
    assert.equal(exp.kid, st.kid);
    assert.equal(exp.jwks.keys[0].kty, "EC");
    assert.ok(!exp.jwks.keys[0].d);
    assert.ok(exp.etag);
  });

  it("dual window exports two keys", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    await rotateKeys(cfg);
    const exp = await exportJwks(cfg);
    assert.equal(exp.jwks.keys.length, 2);
    assert.equal(exp.dualWindowOpen, true);
  });

  it("getJwksCached hit after first fill", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    await invalidateJwksCache(cfg);
    const a = await getJwksCached(cfg);
    assert.ok(a.ok);
    assert.ok(a.cache === "miss" || a.cache === "refresh");
    const b = await getJwksCached(cfg);
    assert.equal(b.cache, "hit");
  });

  it("evaluateJwksCache detects miss and unknown kid", () => {
    const pol = { strategy: "hybrid", cacheTtlMs: 1000, maxStaleMs: 1000 };
    assert.equal(evaluateJwksCache(null, pol).action, "refresh");
    const cache = {
      jwks: { keys: [{ kid: "a", kty: "EC" }] },
      fetchedAt: Date.now(),
    };
    assert.equal(evaluateJwksCache(cache, pol).action, "hit");
    assert.equal(
      evaluateJwksCache(cache, pol, { kid: "missing" }).reason,
      "unknown_kid"
    );
  });

  it("findJwkByKid resolves current kid", async () => {
    const cfg = await tmpCfg();
    const st = await ensureKeyStore(cfg);
    await invalidateJwksCache(cfg);
    const r = await findJwkByKid(cfg, st.kid);
    assert.equal(r.ok, true);
    assert.equal(r.jwk.kid, st.kid);
  });

  it("refreshJwksAfterRotation warms cache", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    const r = await refreshJwksAfterRotation(cfg);
    assert.equal(r.ok, true);
    assert.ok(r.jwks.keys.length >= 1);
  });

  it("toPublicJwkEntry strips private fields", () => {
    const e = toPublicJwkEntry({
      kid: "k1",
      publicJwk: { kty: "EC", crv: "P-256", x: "aa", y: "bb", d: "secret" },
    });
    assert.equal(e.d, undefined);
    assert.equal(e.kid, "k1");
    assert.equal(e.alg, "ES256");
  });

  it("lists strategies", () => {
    const s = listJwksCacheStrategies();
    assert.ok(s.some((x) => x.id === "hybrid"));
  });
});
