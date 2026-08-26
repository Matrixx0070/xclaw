import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ensureKeyStore,
  signWithCurrentKey,
  rotateKeys,
} from "../src/auth/key-rotation.mjs";
import {
  recoverFromCompromise,
  verifyWithRecovery,
  assertCanSign,
  quarantineKeys,
  recoveryStatus,
  revokeKids,
} from "../src/auth/key-compromise-recovery.mjs";

describe("key compromise recovery", () => {
  async function tmpCfg() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-kcr-"));
    return {
      paths: { configDir: dir },
      auth: {
        keys: {
          secret: "recovery-test-secret!",
          rotationStrategy: "dual_slot",
          dualWindowMs: 60_000,
          autoRotate: false,
        },
      },
    };
  }

  it("recoverFromCompromise rotates and revokes old kid", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    const { signature, kid: oldKid } = await signWithCurrentKey(cfg, "secret-msg");
    const r = await recoverFromCompromise(cfg, { reason: "test_leak" });
    assert.equal(r.ok, true);
    assert.notEqual(r.newKid, oldKid);
    assert.ok(r.revokedKids.includes(oldKid));

    const v = await verifyWithRecovery(cfg, "secret-msg", signature);
    assert.equal(v.ok, false);
    assert.equal(v.code, "KEY_REVOKED");
  });

  it("quarantine blocks assertCanSign", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    await quarantineKeys(cfg, "test");
    await assert.rejects(() => assertCanSign(cfg), (e) => e.code === "QUARANTINED");
    const st = await recoveryStatus(cfg);
    assert.equal(st.quarantined, true);
  });

  it("new signatures work after recovery", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    await recoverFromCompromise(cfg, { reason: "test" });
    const { signature, kid } = await signWithCurrentKey(cfg, "fresh");
    const v = await verifyWithRecovery(cfg, "fresh", signature);
    assert.equal(v.ok, true);
    assert.equal(v.kid, kid);
  });
});

// --- The revoked-GENERATION arm of isRevoked (key-compromise-recovery.mjs:136-141)
// is a DISTINCT branch from the revoked-KID arm (line 135). An operator can
// deny-list an entire key GENERATION — revokeKids({ generations: [...] }) — without
// naming individual kids, e.g. when a whole generation's private material is suspect
// but the current live kid must keep signing. verifyWithRecovery reaches the arm on
// its `result.ok` branch: a signature still verifies at the crypto layer (key active
// in the window) yet must be REJECTED because its generation is revoked. Every
// existing revocation test above revokes by KID only, and the one recovery test that
// reaches KEY_REVOKED does so via the SEPARATE revokedPublicKeys crypto loop after
// the dual window is closed (verifyWithRotatedKeys fails first) — so this arm is
// exercised by no test. Neutralizing it (`if (false && ...)`) left the FULL suite
// green (3648/0): a signature from a still-active key whose generation was revoked
// would be silently ACCEPTED. RULE(k) sibling — the publish consumer (exportJwks) is
// pinned separately in test/jwks.test.mjs.
describe("key compromise recovery — revoked-generation arm", () => {
  async function tmpCfg() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-kcr-gen-"));
    return {
      paths: { configDir: dir },
      auth: {
        keys: {
          secret: "recovery-gen-secret!!",
          rotationStrategy: "dual_slot",
          dualWindowMs: 60_000,
          autoRotate: false,
        },
      },
    };
  }

  it("SECURITY: a signature from a REVOKED GENERATION is rejected while the key is still active", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    const { signature, kid, generation } = await signWithCurrentKey(
      cfg,
      "gen-msg"
    );
    // baseline: verifies before any revocation
    const ok0 = await verifyWithRecovery(cfg, "gen-msg", signature);
    assert.equal(ok0.ok, true, "baseline signature must verify before revocation");

    // Revoke the GENERATION only — NOT the kid — and do NOT rotate or close the
    // window, so the key stays in the active verification set. Only the generation
    // arm can catch this; the kid arm sees an un-revoked kid.
    await revokeKids(cfg, { generations: [generation], reason: "compromise" });

    const v = await verifyWithRecovery(cfg, "gen-msg", signature);
    assert.equal(
      v.ok,
      false,
      "a still-active key whose generation was revoked must be rejected (fail-open if accepted)"
    );
    assert.equal(v.code, "KEY_REVOKED");
    assert.equal(v.generation, generation);
    assert.equal(v.kid, kid);
  });

  it("an UNRELATED revoked generation does not reject a good signature (scoped)", async () => {
    const cfg = await tmpCfg();
    await ensureKeyStore(cfg);
    const { signature, generation } = await signWithCurrentKey(cfg, "keep-msg");
    // revoke a generation that is NOT this key's generation
    await revokeKids(cfg, {
      generations: [Number(generation) + 999],
      reason: "unrelated",
    });
    const v = await verifyWithRecovery(cfg, "keep-msg", signature);
    assert.equal(
      v.ok,
      true,
      "revoking an unrelated generation must not reject a good signature"
    );
  });
});
