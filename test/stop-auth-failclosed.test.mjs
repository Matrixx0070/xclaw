/**
 * The /stop gate's CONFIG-DRIVEN fail-closed branches.
 *
 * POST /stop is the session kill-switch: an accepted request aborts every
 * running loop and drains WS+SSE. Its authorization has two branches that only
 * fire when the deployment is MISCONFIGURED — a prod/strict gateway with no stop
 * token, or an hmac-required gateway with no secret. On the live prod gateway a
 * token IS configured, so these branches are never reached there; they are the
 * defense-in-depth that keeps a fat-fingered prod deploy from shipping an
 * unauthenticated kill-switch.
 *
 * Why this file exists (3.200.0): NO test asserted either reject. The tokens
 * STOP_AUTH_REQUIRED / STOP_HMAC_REQUIRED appeared nowhere in the suite except as
 * descriptive strings in gateway-route-coverage's routes map. Proof they were
 * blind: neutering authorizeStop's `if (prod/strict/requireAuth)` to `if (false)`
 * — so a prod gateway with no token returns `{ok:true, skipped, no_token_lab}`
 * and accepts ANY unauthenticated /stop — left the full suite green (3511/0). The
 * same for `const required = false` in verifyStopSignature. A regression that
 * dropped either fail-closed would ship, and a misconfigured prod gateway would
 * expose its kill-switch.
 *
 * The reject SIDE (bad token / bad signature) is already covered by stop-auth /
 * stop-hmac. The accept side (valid token / valid signature) too. What was
 * missing is the third row of each table: "required, but nothing configured ->
 * refuse". These tests pin that row, AND — for symmetry, so a mutation that
 * *closes* the deliberately-open lab path is also caught — the "not required,
 * nothing configured -> skip" row. One case drives the wired route
 * (handleStopAll) to prove the decision reaches an actual HTTP 401, even for a
 * dry-run body (auth is checked before the dry-run bypass).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { authorizeStop, verifyStopSignature } from "../src/gateway/stop-auth.mjs";
import { handleStopAll } from "../src/gateway/stop-route.mjs";

/** Env vars that would supply a token/secret behind cfg's back — must be clear. */
const OVERRIDE_ENV = [
  "XCLAW_STOP_TOKEN",
  "XCLAW_GATEWAY_TOKEN",
  "XCLAW_STOP_AUTH",
  "XCLAW_STOP_HMAC",
  "XCLAW_STOP_HMAC_SECRET",
];

describe("/stop config-driven fail-closed branches", () => {
  const saved = {};

  before(() => {
    for (const k of OVERRIDE_ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  after(() => {
    for (const k of OVERRIDE_ENV) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
  });

  // --- authorizeStop: no token configured -----------------------------------

  it("prod + no token configured -> REFUSE (STOP_AUTH_REQUIRED)", () => {
    const r = authorizeStop({ headers: {} }, { profile: "prod", gateway: {} });
    assert.equal(r.ok, false, "an unconfigured prod gateway must not accept /stop");
    assert.equal(r.code, "STOP_AUTH_REQUIRED");
  });

  it("strict + no token configured -> REFUSE (STOP_AUTH_REQUIRED)", () => {
    const r = authorizeStop({ headers: {} }, { profile: "strict", gateway: {} });
    assert.equal(r.ok, false, "an unconfigured strict gateway must not accept /stop");
    assert.equal(r.code, "STOP_AUTH_REQUIRED");
  });

  it("gateway.requireAuth + no token configured -> REFUSE (STOP_AUTH_REQUIRED)", () => {
    const r = authorizeStop({ headers: {} }, { gateway: { requireAuth: true } });
    assert.equal(r.ok, false, "requireAuth with no token must not accept /stop");
    assert.equal(r.code, "STOP_AUTH_REQUIRED");
  });

  it("lab (no profile, not required) + no token -> deliberately OPEN (skipped)", () => {
    // The asymmetry is intentional: a dev/lab gateway with nothing configured
    // stays open so `xclaw stop` works out of the box. Pinning it means a
    // mutation that flips this to fail-closed is also caught — the truth table
    // is fixed in BOTH directions, not just the security-critical one.
    const r = authorizeStop({ headers: {} }, { gateway: {} });
    assert.equal(r.ok, true, "a lab gateway with no token stays open");
    assert.equal(r.skipped, true);
    assert.equal(r.reason, "no_token_lab");
  });

  // --- verifyStopSignature: hmac required but no secret ----------------------

  it("hmac required + no secret -> REFUSE (STOP_HMAC_REQUIRED)", () => {
    const r = verifyStopSignature({ headers: {} }, { gateway: { stopHmac: true } }, "{}");
    assert.equal(r.ok, false, "hmac required but unconfigured must fail closed");
    assert.equal(r.code, "STOP_HMAC_REQUIRED");
  });

  it("hmac NOT required + no secret -> deliberately SKIPPED (open)", () => {
    const r = verifyStopSignature({ headers: {} }, { gateway: {} }, "{}");
    assert.equal(r.ok, true, "with hmac unset and no secret, the hmac check is skipped");
    assert.equal(r.skipped, true);
  });

  // --- wiring: the decision reaches an actual HTTP 401 ------------------------

  it("handleStopAll: prod + no token -> HTTP 401, even for a dry-run body", async () => {
    let status = 0;
    const res = {
      writeHead(s) {
        status = s;
      },
      end() {},
    };
    const r = await handleStopAll(
      { headers: {}, body: { dryRun: true } },
      res,
      { cfg: { profile: "prod", gateway: {} } }
    );
    assert.equal(status, 401, "an unconfigured prod /stop must answer 401, not run the dry-run");
    assert.equal(r.ok, false);
    assert.equal(r.error, "STOP_AUTH_REQUIRED");
  });
});
