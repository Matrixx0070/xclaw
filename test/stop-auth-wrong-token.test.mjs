/**
 * The kill-switch's credential-ACCEPTANCE half: on POST /stop a WRONG non-empty
 * token must be rejected through every carrier extractStopToken() reads, and only
 * the exact stop token accepted.
 *
 * Why this file exists (3.197.0): authorizeStop() is a SEPARATE gate from the main
 * HTTP check() — its own tokenEqual(), an extra `x-xclaw-stop-token` carrier, and a
 * dedicated stopToken precedence — and it guards the agent kill-switch, so a
 * token-accept bug here lets anyone HALT running work. Yet the whole stop suite only
 * ever asserted missing-token -> 401 (empty) and correct-token -> ok; the one
 * "rejects" case with a body (stop-hmac.test.mjs) sends the CORRECT token plus a bad
 * HMAC sig, so it pins the signature half, not the token compare. Mutating
 * stop-auth.mjs line 92 `if (!tokenEqual(got, expected))` to `if (!got)` — accept ANY
 * presented token — left the full suite green (3464/0): missing-token requests still
 * had got="" so every missing-token test passed, the correct token still passed, and
 * no test ever sent a wrong non-empty token to authorizeStop.
 *
 * These cases pin the acceptance decision itself. They go RED if the compare is
 * dropped to truthiness (a wrong token is accepted) AND red if the compare is
 * inverted (the correct token is rejected). The carrier map mirrors extractStopToken:
 *   Bearer  >  x-xclaw-token / x-xclaw-stop-token / x-api-key  >  ?token= query.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorizeStop } from "../src/gateway/stop-auth.mjs";

const TOKEN = "s3cr3t-stop-token";

/** Every way extractStopToken() can read a token, as a stop-req builder. */
const carriers = {
  "Authorization: Bearer": (t) => ({ headers: { authorization: `Bearer ${t}` } }),
  "x-xclaw-token": (t) => ({ headers: { "x-xclaw-token": t } }),
  "x-xclaw-stop-token": (t) => ({ headers: { "x-xclaw-stop-token": t } }),
  "x-api-key": (t) => ({ headers: { "x-api-key": t } }),
  "?token= query": (t) => ({ url: `/stop?token=${encodeURIComponent(t)}`, headers: {} }),
};

/**
 * Non-empty tokens that are NOT the stop token. A truthiness-only gate accepts every
 * one; the real constant-time compare rejects all. Prefix and superstring cases
 * additionally defend against a startsWith-style weakening in either direction.
 */
const wrong = [
  "nope",
  "s3cr3t-stop-toke", // one char short — got is a prefix of the real token
  "s3cr3t-stop-token-extra", // superstring — the real token is a prefix of got
  "S3CR3T-STOP-TOKEN", // case-flipped, same length
];

describe("POST /stop authorizeStop(): credential acceptance", () => {
  const cfg = { gateway: { token: TOKEN } };

  for (const [name, build] of Object.entries(carriers)) {
    it(`accepts the exact stop token via ${name}`, () => {
      const r = authorizeStop(build(TOKEN), cfg);
      assert.equal(r.ok, true, `exact token must be accepted via ${name}`);
      assert.equal(r.authMethod, "token");
    });

    for (const w of wrong) {
      it(`rejects wrong token ${JSON.stringify(w)} via ${name}`, () => {
        const r = authorizeStop(build(w), cfg);
        assert.equal(r.ok, false, `wrong token must be rejected via ${name}`);
        assert.equal(r.code, "STOP_UNAUTHORIZED");
      });
    }
  }

  // Dedicated stopToken precedence (stopToken || token): when a stop token is set,
  // the general gateway token must NOT open /stop — only the stop token does.
  describe("dedicated stopToken precedence", () => {
    const STOP = "dedicated-stop-only";
    const GENERAL = "general-gateway-token";
    const cfg2 = { gateway: { stopToken: STOP, token: GENERAL } };

    it("accepts the dedicated stop token", () => {
      const r = authorizeStop({ headers: { authorization: `Bearer ${STOP}` } }, cfg2);
      assert.equal(r.ok, true);
    });

    it("rejects the general gateway token when a stop token is configured", () => {
      const r = authorizeStop({ headers: { authorization: `Bearer ${GENERAL}` } }, cfg2);
      assert.equal(r.ok, false, "general token must not open /stop once stopToken is set");
      assert.equal(r.code, "STOP_UNAUTHORIZED");
    });
  });
});
