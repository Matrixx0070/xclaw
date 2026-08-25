/**
 * The computer-control plane's credential-ACCEPTANCE half. verifyComputerAuth()
 * guards real machine control (mouse / keyboard / screenshot) and is a SEPARATE
 * gate from the gateway HTTP check() and the /stop authorizeStop(): it has its own
 * token compare (`got !== token`) AND its own HMAC layer (timestamp replay-window +
 * signature over `${ts}.${body}`). A credential-accept bug here lets an attacker who
 * can reach the computer port drive the machine.
 *
 * Why this file exists (3.198.0): the three files touching this gate
 * (computer-contract, computer-auth-client, auth-proxy) only ever asserted
 * missing-token -> 401, correct-token -> ok, and correct-token + CORRECT HMAC -> ok.
 * No test ever sent a wrong non-empty token, a bad signature, a stale timestamp, or
 * missing HMAC headers when authHmac was on. So BOTH acceptance decisions were
 * unpinned end-to-end:
 *   - mutating `if (got !== token)` (auth.mjs:42) to `if (!got)` — accept ANY
 *     presented token — left the full suite green (3491/0);
 *   - disabling the signature compare (auth.mjs:53) — accept ANY signature —
 *     ALSO left the full suite green (3491/0).
 *
 * These cases pin both halves per-carrier. They go RED if the token compare is
 * dropped to truthiness (a wrong token is accepted), RED if the token compare is
 * inverted (the correct token is rejected), and RED if the HMAC signature check is
 * disabled (a forged signature is accepted).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyComputerAuth } from "../src/computer/auth.mjs";

const TOKEN = "comp-secret-token";

/** Both carriers verifyComputerAuth() reads a token from. */
const carriers = {
  "Authorization: Bearer": (t) => ({ authorization: `Bearer ${t}` }),
  "X-XClaw-Computer-Token": (t) => ({ "x-xclaw-computer-token": t }),
};

/** Non-empty tokens that are NOT the computer token. */
const wrong = [
  "nope",
  "comp-secret-toke", // prefix — got is a prefix of the real token
  "comp-secret-token-extra", // superstring — the real token is a prefix of got
  "COMP-SECRET-TOKEN", // case-flipped, same length
];

describe("verifyComputerAuth(): token acceptance", () => {
  const cfg = { computer: { authToken: TOKEN } };

  for (const [name, build] of Object.entries(carriers)) {
    it(`accepts the exact token via ${name}`, () => {
      const r = verifyComputerAuth(cfg, build(TOKEN));
      assert.equal(r.ok, true, `exact token must be accepted via ${name}`);
      assert.equal(r.mode, "token");
    });

    for (const w of wrong) {
      it(`rejects wrong token ${JSON.stringify(w)} via ${name}`, () => {
        const r = verifyComputerAuth(cfg, build(w));
        assert.equal(r.ok, false, `wrong token must be rejected via ${name}`);
        assert.equal(r.status, 401);
        assert.equal(r.error, "unauthorized");
      });
    }
  }

  it("open mode when no token configured (documented contract)", () => {
    const r = verifyComputerAuth({ computer: {} }, {});
    assert.equal(r.ok, true);
    assert.equal(r.mode, "open");
  });
});

describe("verifyComputerAuth(): HMAC acceptance", () => {
  const cfg = { computer: { authToken: TOKEN, authHmac: true } };
  const body = { cmd: "screenshot", x: 1 };
  const raw = JSON.stringify(body);
  const sign = (ts) =>
    crypto.createHmac("sha256", TOKEN).update(`${ts}.${raw}`).digest("hex");

  it("accepts a correct token with a correct signature", () => {
    const ts = String(Date.now());
    const headers = {
      authorization: `Bearer ${TOKEN}`,
      "x-xclaw-timestamp": ts,
      "x-xclaw-signature": sign(ts),
    };
    const r = verifyComputerAuth(cfg, headers, body);
    assert.equal(r.ok, true);
    assert.equal(r.mode, "token");
  });

  it("rejects a correct token with NO HMAC headers when authHmac is on", () => {
    const r = verifyComputerAuth(cfg, { authorization: `Bearer ${TOKEN}` }, body);
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.equal(r.error, "missing_hmac");
  });

  it("rejects a forged signature of the correct length", () => {
    const ts = String(Date.now());
    const headers = {
      authorization: `Bearer ${TOKEN}`,
      "x-xclaw-timestamp": ts,
      "x-xclaw-signature": "0".repeat(64), // 64 hex chars, exercises timingSafeEqual
    };
    const r = verifyComputerAuth(cfg, headers, body);
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.equal(r.error, "bad_signature");
  });

  it("rejects a forged signature of the wrong length", () => {
    const ts = String(Date.now());
    const headers = {
      authorization: `Bearer ${TOKEN}`,
      "x-xclaw-timestamp": ts,
      "x-xclaw-signature": "deadbeef", // short — exercises the length guard
    };
    const r = verifyComputerAuth(cfg, headers, body);
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.equal(r.error, "bad_signature");
  });

  it("rejects a stale timestamp even with an otherwise-correct signature", () => {
    const ts = String(Date.now() - 6 * 60 * 1000); // 6 min old, past the 5 min window
    const headers = {
      authorization: `Bearer ${TOKEN}`,
      "x-xclaw-timestamp": ts,
      "x-xclaw-signature": sign(ts), // correct sig for THIS ts — isolates the replay-window check
    };
    const r = verifyComputerAuth(cfg, headers, body);
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.equal(r.error, "stale_timestamp");
  });
});
