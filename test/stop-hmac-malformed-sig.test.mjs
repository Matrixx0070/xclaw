/**
 * The kill-switch HMAC second factor's LENGTH-VALIDATION arm.
 *
 * Why this file exists (3.236.0, mutation-sweep #53): verifyStopSignature() compares
 * the presented X-XClaw-Stop-Sig against the server HMAC through hmacEqual(), whose
 * first line is a format guard:
 *
 *     if (a.length !== 32 || b.length !== 32) return false;   // stop-auth.mjs:31
 *
 * That guard rejects any signature that does not decode to exactly 32 bytes BEFORE
 * crypto.timingSafeEqual() (which itself throws on a length mismatch). It is a real
 * enforcement line: on a stopHmac-secret gateway it is the thing that refuses an
 * empty / short / non-hex / over-long signature, so an attacker who holds the stop
 * TOKEN but not the HMAC secret cannot forge a /stop by omitting or mangling the sig.
 *
 * Yet the whole stop suite only ever sent a VALID-length signature to a secret-set
 * gateway: stop-hmac.test.mjs's "rejects bad signature" case uses "00".repeat(32) —
 * exactly 32 bytes — so a.length === 32, the guard is never taken, and timingSafeEqual
 * does the rejecting. No test ever presented a wrong-length signature. Mutating
 * stop-auth.mjs:31 `return false` -> `return true` (accept a malformed signature —
 * fail OPEN) left the full suite green (3665/0): every existing HMAC test used either
 * the correct sig or a 32-byte wrong one, neither of which reaches the guard.
 *
 * These cases pin the length-validation decision itself. Each goes RED if the guard is
 * weakened to accept a malformed signature, and the positive control goes RED if the
 * guard is inverted to reject a valid one. Malformed forms cover every way a hex string
 * fails to decode to 32 bytes: empty, too short, odd-length, non-hex, and over-long.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorizeStop, signStopBody } from "../src/gateway/stop-auth.mjs";

const cfg = { gateway: { token: "secret", stopHmacSecret: "hmac" } };

/** Bearer-token + supplied sig, valid token so the HMAC gate is the decider. */
function stopReq(sig) {
  return { headers: { authorization: "Bearer secret", "x-xclaw-stop-sig": sig }, body: {} };
}

describe("POST /stop HMAC: malformed-signature length guard", () => {
  // Every way an X-XClaw-Stop-Sig fails to decode to exactly 32 bytes.
  const malformed = {
    "empty string": "",
    "one byte (too short)": "00",
    "odd-length hex": "abc",
    "non-hex garbage": "zz".repeat(32),
    "64 bytes (too long)": "00".repeat(64),
  };

  for (const [name, sig] of Object.entries(malformed)) {
    it(`rejects a ${name} signature (STOP_HMAC_INVALID)`, () => {
      const r = authorizeStop(stopReq(sig), cfg);
      assert.equal(r.ok, false, `malformed sig (${name}) must be rejected`);
      assert.equal(r.code, "STOP_HMAC_INVALID");
    });
  }

  // Positive control: a correctly-lengthed valid signature is still accepted, so the
  // guard cannot be "fixed" by rejecting everything.
  it("still accepts a valid signature", () => {
    const sig = signStopBody("hmac", JSON.stringify({}));
    const r = authorizeStop(stopReq(sig), cfg);
    assert.equal(r.ok, true, "a valid signature must still be accepted");
  });
});
