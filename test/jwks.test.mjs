import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ensureKeyStore,
  rotateKeys,
  keyRotationStatus,
} from "../src/auth/key-rotation.mjs";
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
import { revokeKids } from "../src/auth/key-compromise-recovery.mjs";

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

// --- The revoked-key filter in exportJwks (jwks.mjs:102-110): when a kid has
// been revoked via compromise recovery, it must be EXCLUDED from the published
// JWKS document, or verifiers that fetch the JWKS keep trusting the compromised
// key. This is a real auth boundary, but every existing exportJwks test above
// exercises only NON-revoked keys ("dual window exports two keys" asserts 2, but
// neither is revoked), so the `if (await isRevoked(...)) continue;` skip never
// fires in the suite. Neutralizing that skip (`if (false && await isRevoked...)`)
// so a revoked kid stays published left the FULL suite green (3646/0) — a silent
// removal of the revocation filter would ship a compromised key in the JWKS
// unnoticed. These pin the default-on filter AND the filterRevoked:false opt-out.
describe("JWKS revoked-key filter (exportJwks)", () => {
  async function tmpCfg(jwksExtra = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-jwks-rev-"));
    return {
      paths: { configDir: dir },
      auth: {
        keys: {
          secret: "jwks-revoke-secret!!!!",
          rotationStrategy: "dual_slot",
          dualWindowMs: 60_000,
          autoRotate: false,
        },
        jwks: { cacheStrategy: "hybrid", ...jwksExtra },
      },
    };
  }

  it("SECURITY: a revoked kid is EXCLUDED from the published JWKS", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    await rotateKeys(cfg); // dual window: current + previous
    const before = await exportJwks(cfg);
    assert.equal(
      before.jwks.keys.length,
      2,
      "dual window must publish both keys before revocation"
    );
    const kids = before.jwks.keys.map((k) => k.kid);
    const revokedKid = kids[0];
    const keptKid = kids[1];

    await revokeKids(cfg, { kids: [revokedKid], reason: "compromise" });

    const after = await exportJwks(cfg);
    const afterKids = after.jwks.keys.map((k) => k.kid);
    assert.ok(
      !afterKids.includes(revokedKid),
      "a revoked/compromised kid must NOT remain in the published JWKS (fail-open if it does)"
    );
    assert.ok(
      afterKids.includes(keptKid),
      "the non-revoked kid must still be published"
    );
    assert.equal(after.jwks.keys.length, 1);
    assert.equal(after.keyCount, 1);
  });

  // RULE(k) sibling: exportJwks is the OUTBOUND (publish) consumer of isRevoked,
  // distinct from verifyWithRecovery's inbound path. Its filter calls
  // isRevoked(cfg, { kid, generation }) — so revoking by GENERATION alone (no kid)
  // must ALSO drop the key from the JWKS. The kid-only test above cannot catch a
  // regression in the generation arm; neutralizing that arm left the suite green.
  it("SECURITY: a revoked GENERATION (no kid) is EXCLUDED from the published JWKS", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    await rotateKeys(cfg); // dual window: current + previous
    const st = await keyRotationStatus(cfg);
    const prevGen = st.dualWindow?.previousGeneration;
    const prevKid = st.dualWindow?.previousKid;
    assert.ok(prevGen != null, "dual window must expose a previous generation");
    assert.ok(prevKid, "dual window must expose a previous kid");

    const before = await exportJwks(cfg);
    assert.equal(before.jwks.keys.length, 2, "both keys published before revocation");

    // Revoke by GENERATION only — do NOT name the kid.
    await revokeKids(cfg, { generations: [prevGen], reason: "compromise" });

    const after = await exportJwks(cfg);
    const afterKids = after.jwks.keys.map((k) => k.kid);
    assert.ok(
      !afterKids.includes(prevKid),
      "a key whose generation was revoked must NOT remain in the published JWKS (fail-open if it does)"
    );
    assert.ok(afterKids.includes(st.kid), "the current kid must still be published");
    assert.equal(after.jwks.keys.length, 1);
    assert.equal(after.keyCount, 1);
  });

  it("filterRevoked:false keeps a revoked kid in the JWKS (explicit opt-out)", async () => {
    const cfg = await tmpCfg({ filterRevoked: false });
    await ensureKeyStore(cfg);
    await rotateKeys(cfg);
    const before = await exportJwks(cfg);
    const revokedKid = before.jwks.keys[0].kid;

    await revokeKids(cfg, { kids: [revokedKid], reason: "compromise" });

    const after = await exportJwks(cfg);
    assert.ok(
      after.jwks.keys.map((k) => k.kid).includes(revokedKid),
      "with filterRevoked:false the operator opts out — even revoked kids are published"
    );
    assert.equal(after.jwks.keys.length, 2);
  });
});
