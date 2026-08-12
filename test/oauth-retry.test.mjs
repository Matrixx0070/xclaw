import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isOAuthRetryable,
  withOAuthRetry,
  throwIfRetryableFailure,
} from "../src/auth/oauth-retry.mjs";
import { OAuthErrorCode } from "../src/auth/oauth-errors.mjs";

describe("oauth retry logic", () => {
  it("does not retry reauth errors", () => {
    assert.equal(
      isOAuthRetryable({
        ok: false,
        code: OAuthErrorCode.REFRESH_INVALID,
        reauth: true,
      }),
      false
    );
  });

  it("retries network errors", () => {
    assert.equal(
      isOAuthRetryable({
        ok: false,
        code: OAuthErrorCode.TOKEN_NETWORK,
        retryable: true,
      }),
      true
    );
  });

  it("retries 503 token_http", () => {
    assert.equal(
      isOAuthRetryable({
        ok: false,
        code: OAuthErrorCode.TOKEN_HTTP,
        httpStatus: 503,
      }),
      true
    );
  });

  it("does not retry 400 token_http", () => {
    assert.equal(
      isOAuthRetryable({
        ok: false,
        code: OAuthErrorCode.TOKEN_HTTP,
        httpStatus: 400,
      }),
      false
    );
  });

  it("withOAuthRetry succeeds after transient failures", async () => {
    let n = 0;
    const out = await withOAuthRetry(
      async () => {
        n += 1;
        if (n < 3) {
          return {
            ok: false,
            code: OAuthErrorCode.TOKEN_NETWORK,
            error: "fail",
            retryable: true,
          };
        }
        return { ok: true, accessToken: "tok" };
      },
      { retries: 5, baseMs: 1, maxDelayMs: 5, strategy: "none" }
    );
    assert.equal(out.ok, true);
    assert.equal(out.accessToken, "tok");
    assert.equal(n, 3);
  });

  it("withOAuthRetry exhausts and returns last failure", async () => {
    const out = await withOAuthRetry(
      async () => ({
        ok: false,
        code: OAuthErrorCode.REFRESH_NETWORK,
        error: "down",
        retryable: true,
      }),
      { retries: 2, baseMs: 1, maxDelayMs: 5, strategy: "none" }
    );
    assert.equal(out.ok, false);
    assert.equal(out.retriesExhausted, true);
  });

  it("throwIfRetryableFailure throws on retryable", () => {
    assert.throws(() =>
      throwIfRetryableFailure({
        ok: false,
        code: OAuthErrorCode.TOKEN_NETWORK,
        retryable: true,
        error: "x",
      })
    );
  });
});
