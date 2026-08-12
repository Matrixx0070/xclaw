/**
 * Structured OAuth / token-refresh errors.
 *
 * Every failure should carry:
 *   ok: false
 *   code: stable machine id
 *   error: human message
 *   reauth?: boolean   — operator must run browser login again
 *   retryable?: boolean
 *   httpStatus?: number
 *   provider?: string
 *   detail?: unknown
 */

export const OAuthErrorCode = Object.freeze({
  // Browser / authorize
  MISSING_CONFIG: "missing_config",
  STATE_MISMATCH: "state_mismatch",
  PROVIDER_DENIED: "provider_denied",
  CALLBACK_TIMEOUT: "callback_timeout",
  CALLBACK_PORT_BUSY: "callback_port_busy",
  MISSING_CODE: "missing_code",

  // Token exchange
  TOKEN_NETWORK: "token_network",
  TOKEN_HTTP: "token_http",
  TOKEN_NO_ACCESS: "token_no_access",

  // Refresh
  UNKNOWN_APP: "unknown_app",
  NO_TOKEN: "no_token",
  NO_REFRESH_TOKEN: "no_refresh_token",
  NO_CLIENT_ID: "no_client_id",
  EXPIRED_NO_REFRESH: "expired_no_refresh",
  REFRESH_INVALID: "refresh_invalid",
  REFRESH_HTTP: "refresh_http",
  REFRESH_NETWORK: "refresh_network",

  // Generic
  INTERNAL: "internal",
});

/**
 * @param {string} code
 * @param {string} message
 * @param {object} [extra]
 */
export function oauthError(code, message, extra = {}) {
  const reauthCodes = new Set([
    OAuthErrorCode.REFRESH_INVALID,
    OAuthErrorCode.EXPIRED_NO_REFRESH,
    OAuthErrorCode.NO_REFRESH_TOKEN,
    OAuthErrorCode.PROVIDER_DENIED,
    OAuthErrorCode.STATE_MISMATCH,
  ]);
  const retryableCodes = new Set([
    OAuthErrorCode.TOKEN_NETWORK,
    OAuthErrorCode.REFRESH_NETWORK,
    OAuthErrorCode.CALLBACK_PORT_BUSY,
    OAuthErrorCode.REFRESH_HTTP,
    OAuthErrorCode.TOKEN_HTTP,
  ]);
  const codeStr = code || OAuthErrorCode.INTERNAL;
  return {
    ok: false,
    code: codeStr,
    error: String(message || codeStr),
    reauth: extra.reauth ?? reauthCodes.has(codeStr),
    retryable: extra.retryable ?? retryableCodes.has(codeStr),
    ...extra,
  };
}

/**
 * Map HTTP status + OAuth error body to a code.
 */
export function classifyTokenHttpError(status, body = {}) {
  const err = String(body.error || body.error_description || "").toLowerCase();
  if (status === 400 && /invalid_grant|invalid_token|revoked|expired/.test(err)) {
    return OAuthErrorCode.REFRESH_INVALID;
  }
  if (status === 401 || /invalid_client/.test(err)) {
    return OAuthErrorCode.REFRESH_INVALID;
  }
  if (status >= 500) {
    return OAuthErrorCode.TOKEN_HTTP;
  }
  if (status === 429) {
    return OAuthErrorCode.TOKEN_HTTP;
  }
  return OAuthErrorCode.TOKEN_HTTP;
}

/**
 * Operator-facing recovery hints.
 */
export function recoveryHint(code) {
  const hints = {
    [OAuthErrorCode.MISSING_CONFIG]:
      "Set XCLAW_<APP>_OAUTH_CLIENT_ID (and SECRET if required).",
    [OAuthErrorCode.STATE_MISMATCH]:
      "Retry login; do not reuse an old authorize URL.",
    [OAuthErrorCode.PROVIDER_DENIED]:
      "User denied consent or scopes missing — retry and approve.",
    [OAuthErrorCode.CALLBACK_TIMEOUT]:
      "Complete browser consent within 3 minutes, or raise timeout.",
    [OAuthErrorCode.CALLBACK_PORT_BUSY]:
      "Change XCLAW_OAUTH_CALLBACK_PORT; ensure callback URL matches the OAuth app.",
    [OAuthErrorCode.TOKEN_NETWORK]:
      "Check network / DNS to the provider token endpoint.",
    [OAuthErrorCode.TOKEN_HTTP]:
      "Verify client id/secret and redirect_uri registration.",
    [OAuthErrorCode.TOKEN_NO_ACCESS]:
      "Provider response lacked access_token — check scopes and app type.",
    [OAuthErrorCode.NO_TOKEN]:
      "Run: xclaw auth connected login <app>",
    [OAuthErrorCode.NO_REFRESH_TOKEN]:
      "Provider did not issue refresh_token — re-login with offline access if supported.",
    [OAuthErrorCode.NO_CLIENT_ID]:
      "Set client id env var for this provider.",
    [OAuthErrorCode.EXPIRED_NO_REFRESH]:
      "Access token expired; re-login (no refresh_token on file).",
    [OAuthErrorCode.REFRESH_INVALID]:
      "Refresh rejected (revoked/rotated). Tokens cleared — run connected login again.",
    [OAuthErrorCode.REFRESH_HTTP]:
      "Transient or config error on refresh — retry; if persistent, re-login.",
    [OAuthErrorCode.REFRESH_NETWORK]:
      "Network error during refresh — retry.",
    [OAuthErrorCode.UNKNOWN_APP]:
      "Use a known app id: github | google",
  };
  return hints[code] || "See docs/OAUTH_BROWSER.md and docs/TOKEN_REFRESH.md";
}

export function withHint(err) {
  if (!err || err.ok !== false) return err;
  return {
    ...err,
    hint: err.hint || recoveryHint(err.code),
  };
}
