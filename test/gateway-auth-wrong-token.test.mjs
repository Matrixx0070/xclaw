/**
 * The HTTP gate's credential-ACCEPTANCE half: on a protected path a WRONG
 * non-empty token must be rejected through every carrier, and only the exact
 * operator token accepted.
 *
 * Why this file exists (3.196.0): the whole in-process check() surface only
 * asserted no-token -> 401 and correct-token -> 200. Neither notices a compare
 * weakened to a truthiness test. Mutating auth.mjs line 292
 * `if (tokenEqual(got, token))` to `if (got)` — accept ANY presented token —
 * left the full suite green (3444/0): no-token requests still fell through to
 * 401 so every no-token test passed, the correct token still passed, and no
 * HTTP test ever sent a wrong non-empty token. Only the WS path
 * (ws-auth.test.mjs `?token=nope`) pinned wrong-token -> 401, and that drives
 * the separate authorizeWebSocket(); the HTTP check() acceptance half was
 * untested.
 *
 * These cases pin the acceptance decision itself. They go RED if the compare is
 * dropped to truthiness (a wrong token is accepted) AND red if the compare is
 * inverted (the correct token is rejected). The carrier map mirrors
 *   got = bearer || x-xclaw-token/x-api-key || ?token=  (auth.mjs check()).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGatewayAuth } from "../src/gateway/auth.mjs";

const TOKEN = "s3cr3t-operator-token";
const PROTECTED = "/agent/run";

/** Every way a caller can hand check() a token, as a req builder. */
const carriers = {
  "Authorization: Bearer": (t) => ({ url: PROTECTED, headers: { authorization: `Bearer ${t}` } }),
  "x-xclaw-token": (t) => ({ url: PROTECTED, headers: { "x-xclaw-token": t } }),
  "x-api-key": (t) => ({ url: PROTECTED, headers: { "x-api-key": t } }),
  "?token= query": (t) => ({ url: `${PROTECTED}?token=${encodeURIComponent(t)}`, headers: {} }),
};

/**
 * Non-empty tokens that are NOT the operator token. A truthiness-only gate
 * accepts every one; the real constant-time compare rejects all. The prefix and
 * superstring cases additionally defend against a startsWith-style weakening in
 * either direction (got is a prefix of token / token is a prefix of got).
 */
const wrong = [
  "nope",
  "s3cr3t-operator-toke", // one char short — got is a prefix of the real token
  "s3cr3t-operator-token-extra", // superstring — the real token is a prefix of got
  "S3CR3T-OPERATOR-TOKEN", // case-flipped, same length
];

describe("gateway HTTP check(): credential acceptance", () => {
  const auth = createGatewayAuth({ gateway: { token: TOKEN } });

  for (const [name, build] of Object.entries(carriers)) {
    it(`accepts the exact token via ${name}`, () => {
      const r = auth.check(build(TOKEN));
      assert.equal(r.ok, true, `exact token must be accepted via ${name}`);
      assert.equal(r.mode, "token");
    });

    for (const w of wrong) {
      it(`rejects wrong token ${JSON.stringify(w)} via ${name}`, () => {
        const r = auth.check(build(w));
        assert.equal(r.ok, false, `wrong token must be rejected via ${name}`);
        assert.equal(r.error, "unauthorized");
      });
    }
  }
});
