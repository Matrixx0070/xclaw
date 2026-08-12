import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  oauthError,
  withHint,
  classifyTokenHttpError,
  recoveryHint,
  OAuthErrorCode,
} from "../src/auth/oauth-errors.mjs";

describe("oauth error handling", () => {
  it("marks refresh_invalid as reauth", () => {
    const e = oauthError(OAuthErrorCode.REFRESH_INVALID, "invalid_grant");
    assert.equal(e.ok, false);
    assert.equal(e.reauth, true);
    assert.equal(e.retryable, false);
  });

  it("marks token_network as retryable", () => {
    const e = oauthError(OAuthErrorCode.TOKEN_NETWORK, "ECONNRESET");
    assert.equal(e.retryable, true);
    assert.equal(e.reauth, false);
  });

  it("classifyTokenHttpError detects invalid_grant", () => {
    assert.equal(
      classifyTokenHttpError(400, { error: "invalid_grant" }),
      OAuthErrorCode.REFRESH_INVALID
    );
  });

  it("withHint attaches recovery text", () => {
    const e = withHint(oauthError(OAuthErrorCode.NO_TOKEN, "no token"));
    assert.ok(e.hint.includes("login"));
    assert.equal(recoveryHint(OAuthErrorCode.CALLBACK_PORT_BUSY).includes("PORT"), true);
  });
});
