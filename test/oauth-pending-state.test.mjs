/**
 * OAuth callback `state` authenticator — createPending / takePending.
 *
 * `/oauth/callback` and `/auth/callback` (GET) are intentionally OPEN to gateway
 * auth: an IdP browser redirect cannot carry a Bearer token. auth.mjs treats
 * them as not-protected and gateway-served-inventory.test.mjs pins them as
 * "OAuth AS browser redirect; state-authenticated, not token" — i.e. those tests
 * pin the OPENNESS, the intended state, not the guard. The SOLE authenticator of
 * who may complete a callback (drive the PKCE token exchange in
 * routes/oauth-callback.mjs and setAppToken for a connected app) is therefore
 * the `state` token minted by createPending and consumed by takePending — and it
 * had ZERO behavioural test: no test imported connected/oauth-pending.mjs.
 *
 * Why it matters (sweep #26): mutating takePending's unknown-state return to
 * accept — `if (!entry) return { state, forged: true }` — left the FULL suite
 * green (3570/0). A callback carrying an unknown/forged `state` would then be
 * treated as a legitimate pending login. This file pins the authenticator's
 * decisions: accept a genuine state once (round-trip), REJECT an unknown/forged
 * state, and — the crux — treat every state as SINGLE-USE (consume-on-take, so a
 * replayed callback URL cannot re-drive the exchange), plus REJECT an expired
 * state. Consume must hold across both the in-memory and on-disk stores.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createPending,
  takePending,
} from "../src/connected/oauth-pending.mjs";

let TMP;
let cfg;
beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-oauth-pending-"));
  cfg = { paths: { configDir: TMP } };
});
afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

const record = (over = {}) => ({
  appId: "acme",
  tokenUrl: "https://idp.example/token",
  clientId: "cid",
  verifier: "pkce-verifier",
  ...over,
});

describe("OAuth callback state authenticator — createPending / takePending", () => {
  it("accepts a genuine state exactly once (round-trip)", async () => {
    const { state } = await createPending(cfg, record());
    assert.ok(state, "createPending must mint a state");
    const got = await takePending(cfg, state);
    assert.ok(got, "a genuine, unconsumed state must be accepted");
    assert.equal(got.appId, "acme");
    assert.equal(got.tokenUrl, "https://idp.example/token");
    assert.equal(got.verifier, "pkce-verifier");
  });

  it("REJECTS an unknown / forged state (the proven mutation)", async () => {
    // Nothing was created for this state — a callback that invented it must not
    // be treated as a pending login. accept-forged is a bypass of the only guard
    // on the auth-open /oauth/callback + /auth/callback routes.
    const got = await takePending(cfg, "forged-" + "a".repeat(24));
    assert.equal(got, null, "an unknown/forged state must be rejected");
  });

  it("is SINGLE-USE — a consumed state cannot be replayed (mem + disk)", async () => {
    const { state } = await createPending(cfg, record());
    const first = await takePending(cfg, state);
    assert.ok(first, "first take of a genuine state must succeed");
    // A replayed callback URL carrying the same state must not re-drive the
    // token exchange: consume-on-take, across BOTH the in-memory Map and the
    // on-disk oauth-pending.json.
    const replay = await takePending(cfg, state);
    assert.equal(replay, null, "a second take of the same state must be rejected");
    // and the on-disk record must be gone too
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(TMP, "oauth-pending.json"), "utf8"),
    );
    assert.equal(onDisk[state], undefined, "consumed state must be deleted from disk");
  });

  it("REJECTS an expired state", async () => {
    // ttlMs in the past -> expiresAt already elapsed at take time.
    const { state } = await createPending(cfg, record({ ttlMs: -1 }));
    const got = await takePending(cfg, state);
    assert.equal(got, null, "an expired state must be rejected");
  });

  it("binds the state to its own record — one state never yields another's entry", async () => {
    const a = await createPending(cfg, record({ appId: "alpha" }));
    const b = await createPending(cfg, record({ appId: "beta" }));
    const gotB = await takePending(cfg, b.state);
    assert.equal(gotB.appId, "beta", "state B must yield B's record, not A's");
    // consuming B must not consume A
    const gotA = await takePending(cfg, a.state);
    assert.equal(gotA.appId, "alpha", "state A must remain independently valid");
  });
});
