/**
 * Inbound PagerDuty webhook — the HMAC signature verifier.
 *
 * `/webhooks/pagerduty` (POST) is intentionally OPEN to gateway auth — a
 * PagerDuty delivery cannot carry a Bearer token (auth.mjs:94 returns
 * not-protected for /webhooks/*, and gateway-auth-cost-usage.test.mjs pins that
 * it "must stay open for signed deliveries"). The SOLE authenticator of who may
 * POST a webhook that runs handlePagerDutyWebhook (mirrors events to channels,
 * appends history) is therefore verifyPagerDutySignature — and it had ZERO
 * behavioural test: no test imported pagerduty-webhooks.mjs. The two tests that
 * name the path only assert it is a known served literal / stays auth-open;
 * neither exercises signature acceptance or rejection. computer-auth-wrong-cred
 * tests a DIFFERENT verifier (the computer plane's verifyComputerAuth).
 *
 * Why it matters (sweep #25, 3.207.0): mutating the bad-signature return to
 * accept — `return { ok: true, mode: "hmac", matchedVersion: "v1" }` — left the
 * FULL suite green (3562/0). A FORGED webhook would then be accepted and
 * processed: a total inbound-webhook-auth bypass on an open route. This file
 * pins the verifier's decisions: accept a genuine signature, REJECT a forged
 * one, REJECT a missing one, honor the open/required policy, honor the rotation
 * list, and — the crux — REJECT a signature that is valid for a DIFFERENT body
 * (the HMAC must bind the exact bytes it authenticates).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  verifyPagerDutySignature,
  computePagerDutySignature,
} from "../src/alerting/pagerduty-webhooks.mjs";

const SECRET = "shhh-pd-secret";
const BODY = JSON.stringify({ event: { event_type: "incident.triggered" } });
const goodSig = (body = BODY, secret = SECRET) =>
  `v1=${computePagerDutySignature(body, secret)}`;

describe("PagerDuty webhook — verifyPagerDutySignature", () => {
  it("accepts a genuine signature", () => {
    const r = verifyPagerDutySignature(BODY, goodSig(), SECRET);
    assert.equal(r.ok, true);
    assert.equal(r.mode, "hmac");
    assert.equal(r.matchedVersion, "v1");
  });

  it("REJECTS a forged signature (the proven mutation)", () => {
    // A wrong-but-well-formed hex digest — accept-forged is a total bypass of
    // the only guard on the auth-open /webhooks/pagerduty route.
    const forged = "v1=" + "a".repeat(64);
    const r = verifyPagerDutySignature(BODY, forged, SECRET);
    assert.equal(r.ok, false, "a forged signature must be rejected");
    assert.equal(r.reason, "bad_signature");
  });

  it("REJECTS a missing signature header when a secret is configured", () => {
    const r = verifyPagerDutySignature(BODY, "", SECRET);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_signature");
  });

  it("REJECTS a signature that is valid for a DIFFERENT body (HMAC binds the bytes)", () => {
    // The signature is genuine — but for OTHER bytes. A replay/tamper where the
    // attacker swaps the payload under a captured signature must not verify.
    const sigForOtherBody = goodSig(JSON.stringify({ event: { event_type: "x" } }));
    const r = verifyPagerDutySignature(BODY, sigForOtherBody, SECRET);
    assert.equal(r.ok, false, "a signature for other bytes must not verify this body");
    assert.equal(r.reason, "bad_signature");
  });

  it("is OPEN when no secret is configured and signing is not required", () => {
    const r = verifyPagerDutySignature(BODY, "", null);
    assert.equal(r.ok, true);
    assert.equal(r.mode, "open");
  });

  it("FAILS CLOSED when signing is required but no secret is configured", () => {
    const r = verifyPagerDutySignature(BODY, goodSig(), null, { required: true });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "secret_not_configured");
  });

  it("honors the rotation list — a signature from ANY configured secret is accepted", () => {
    const secrets = ["old-secret", SECRET];
    // signed with the NEWER (second) secret
    const r = verifyPagerDutySignature(BODY, goodSig(BODY, SECRET), secrets);
    assert.equal(r.ok, true, "a signature matching any rotation secret must verify");
    // and a secret NOT in the list is still rejected
    const bad = verifyPagerDutySignature(BODY, goodSig(BODY, "not-in-list"), secrets);
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "bad_signature");
  });

  it("accepts a bare-hex header (no v1= prefix) with a genuine digest", () => {
    const bare = computePagerDutySignature(BODY, SECRET); // no "v1=" prefix
    const r = verifyPagerDutySignature(BODY, bare, SECRET);
    assert.equal(r.ok, true);
    assert.equal(r.mode, "hmac");
  });
});
