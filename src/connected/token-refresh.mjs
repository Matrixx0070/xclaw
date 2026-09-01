/**
 * Token refresh logic for connected OAuth apps.
 *
 * - Expiry skew (refresh before absolute expiry)
 * - Single-flight lock per app (no concurrent refresh stampede)
 * - Refresh-token rotation (store new RT when returned)
 * - Reuse detection: if refresh fails with invalid_grant after rotation, clear store
 * - Optimistic updatedAt check before write
 */
import { getConnectedOAuthProvider } from "./oauth-providers.mjs";
import { getAppToken, loadTokens, saveTokens } from "./token-store.mjs";
import { refreshAccessToken } from "../auth/oauth-browser.mjs";
import {
  oauthError,
  withHint,
  OAuthErrorCode,
  classifyTokenHttpError,
} from "../auth/oauth-errors.mjs";

/** Default: refresh if expires within 5 minutes */
export const DEFAULT_SKEW_MS = 5 * 60 * 1000;

/** @type {Map<string, Promise<object>>} */
const inflight = new Map();

export function isTokenExpired(record, now = Date.now(), skewMs = DEFAULT_SKEW_MS) {
  if (!record) return true;
  if (!record.expiresAt) return false; // no expiry → treat as non-expiring (e.g. GitHub classic)
  const t = Date.parse(record.expiresAt);
  if (Number.isNaN(t)) return false;
  return now >= t - skewMs;
}

export function needsRefresh(record, opts = {}) {
  if (!record) return false;
  if (!record.refreshToken) return false;
  if (opts.force) return true;
  return isTokenExpired(record, opts.now, opts.skewMs ?? DEFAULT_SKEW_MS);
}

function resolveClient(provider, stored = {}, opts = {}) {
  const clientId =
    opts.clientId ||
    stored.clientId ||
    process.env[provider.envClientId] ||
    process.env[`XCLAW_${provider.id.toUpperCase()}_CLIENT_ID`];
  const clientSecret =
    opts.clientSecret ||
    process.env[provider.envClientSecret] ||
    process.env[`XCLAW_${provider.id.toUpperCase()}_CLIENT_SECRET`] ||
    "";
  return { clientId, clientSecret };
}

/**
 * Re-read after unbounded refreshAccessToken. deleteAppToken /
 * logoutConnected are concurrent writers of the same file. Save of
 * the held THIS-app record must not resurrect a deleted app.
 *
 * missing held → null
 * missing onDisk → null (do not resurrect the file)
 * missing held.apps[appId] → null
 * missing onDisk.apps[appId] → null (this app was deleted / logout-all)
 * else overlay held.apps[appId] onto onDisk so other-app deletes survive
 */
export function settleAfterAppRefresh(heldStore, onDisk, appId) {
  if (!heldStore) return null;
  if (!onDisk) return null;
  if (!heldStore.apps?.[appId]) return null;
  if (!onDisk.apps?.[appId]) return null;
  return {
    ...onDisk,
    apps: {
      ...onDisk.apps,
      [appId]: heldStore.apps[appId],
    },
  };
}

async function persistRefreshedApp(cfg, appId, tokenRecord) {
  const held = {
    version: 1,
    apps: {
      [appId]: {
        ...tokenRecord,
        updatedAt: new Date().toISOString(),
      },
    },
  };
  const onDisk = await loadTokens(cfg);
  const settled = settleAfterAppRefresh(held, onDisk, appId);
  if (!settled) return null;
  await saveTokens(cfg, settled);
  return settled.apps[appId];
}

/**
 * Perform refresh for one app (no lock). Prefer ensureFreshToken.
 */
export async function refreshAppToken(cfg, appId, opts = {}) {
  const provider = getConnectedOAuthProvider(appId);
  if (!provider) {
    return withHint(oauthError(OAuthErrorCode.UNKNOWN_APP, `unknown oauth app: ${appId}`, { provider: appId }));
  }
  const stored = await getAppToken(cfg, appId);
  if (!stored?.refreshToken) {
    return withHint(oauthError(OAuthErrorCode.NO_REFRESH_TOKEN, "no refresh_token — re-run oauth login", { provider: appId }));
  }

  const { clientId, clientSecret } = resolveClient(provider, stored, opts);
  if (!clientId) {
    return withHint(
      oauthError(
        OAuthErrorCode.NO_CLIENT_ID,
        `missing client id (${provider.envClientId})`,
        { provider: appId, env: provider.envClientId }
      )
    );
  }

  const priorRefresh = stored.refreshToken;
  const priorUpdatedAt = stored.updatedAt;

  const result = await refreshAccessToken({
    tokenUrl: opts.tokenUrl || stored.tokenUrl || provider.tokenUrl,
    clientId,
    clientSecret: clientSecret || undefined,
    refreshToken: priorRefresh,
  });

  if (!result.ok) {
    const errBody = result.body || {};
    const oauthErr = errBody.error || errBody.error_description || result.error;
    // invalid_grant often means RT revoked or already rotated (reuse)
    if (
      /invalid_grant|invalid_token|revoked/i.test(String(oauthErr)) ||
      result.error?.includes("400") ||
      result.error?.includes("401")
    ) {
      await invalidateAppTokens(cfg, appId, {
        reason: "refresh_failed",
        detail: String(oauthErr).slice(0, 200),
      });
      return withHint(
        oauthError(
          OAuthErrorCode.REFRESH_INVALID,
          `refresh failed — tokens cleared; re-login required: ${oauthErr}`,
          { provider: appId, detail: oauthErr, reauth: true }
        )
      );
    }
    return withHint(
      oauthError(
        result.code === OAuthErrorCode.REFRESH_INVALID
          ? OAuthErrorCode.REFRESH_INVALID
          : OAuthErrorCode.REFRESH_HTTP,
        result.error || "refresh failed",
        { provider: appId, body: result.body, httpStatus: result.httpStatus, reauth: result.reauth }
      )
    );
  }

  // Optimistic concurrency: if another writer updated the store, merge carefully
  const latest = await getAppToken(cfg, appId);
  if (!latest) {
    return withHint(
      oauthError(OAuthErrorCode.NO_TOKEN, "no token — concurrent delete won", { provider: appId })
    );
  }
  if (latest.updatedAt && priorUpdatedAt && latest.updatedAt !== priorUpdatedAt) {
    // Another refresh may have won; if still fresh, use it
    if (!isTokenExpired(latest) && latest.accessToken) {
      return {
        ok: true,
        provider: appId,
        accessToken: latest.accessToken,
        source: "store_race_winner",
        rotated: latest.refreshToken !== priorRefresh,
      };
    }
  }

  const newRefresh = result.refreshToken || priorRefresh;
  const rotated = Boolean(result.refreshToken && result.refreshToken !== priorRefresh);
  const expiresAt =
    result.expiresIn != null
      ? new Date(Date.now() + Number(result.expiresIn) * 1000).toISOString()
      : stored.expiresAt || null;

  const persisted = await persistRefreshedApp(cfg, appId, {
    ...stored,
    ...latest,
    accessToken: result.accessToken,
    refreshToken: newRefresh,
    expiresAt,
    tokenType: result.raw?.token_type || stored.tokenType || "Bearer",
    scope: result.raw?.scope || stored.scope,
    clientId,
    source: "oauth_refresh",
    lastRefreshAt: new Date().toISOString(),
    refreshRotated: rotated,
  });
  if (!persisted) {
    return withHint(
      oauthError(OAuthErrorCode.NO_TOKEN, "no token — concurrent delete won", { provider: appId })
    );
  }

  return {
    ok: true,
    provider: appId,
    accessToken: result.accessToken,
    expiresAt,
    rotated,
    source: "refresh",
  };
}

/**
 * Clear tokens after failed refresh / reuse detection.
 */
export async function invalidateAppTokens(cfg, appId, meta = {}) {
  const data = await loadTokens(cfg);
  if (!data.apps?.[appId]) return;
  const prev = data.apps[appId];
  data.apps[appId] = {
    invalidatedAt: new Date().toISOString(),
    reason: meta.reason || "invalidated",
    detail: meta.detail,
    // keep clientId for easier re-login
    clientId: prev.clientId,
  };
  await saveTokens(cfg, data);
}

/**
 * Single-flight ensure: return a valid access token, refreshing if needed.
 */
export async function ensureFreshToken(cfg, appId, opts = {}) {
  const envMap = {
    github: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    voice: process.env.TTS_API_KEY || process.env.OPENAI_API_KEY || process.env.XAI_API_KEY,
  };
  if (envMap[appId] && !opts.preferStore) {
    return {
      ok: true,
      accessToken: envMap[appId],
      source: "env",
      refreshed: false,
    };
  }

  let stored = await getAppToken(cfg, appId);
  if (!stored?.accessToken && !stored?.token) {
    return withHint(oauthError(OAuthErrorCode.NO_TOKEN, "no token", { provider: appId }));
  }

  if (!needsRefresh(stored, opts) && !opts.force) {
    return {
      ok: true,
      accessToken: stored.accessToken || stored.token,
      source: "store",
      refreshed: false,
      expiresAt: stored.expiresAt,
    };
  }

  if (!stored.refreshToken) {
    // Expired with no RT
    if (isTokenExpired(stored, opts.now, opts.skewMs ?? DEFAULT_SKEW_MS)) {
      return withHint(
        oauthError(
          OAuthErrorCode.EXPIRED_NO_REFRESH,
          "access token expired and no refresh_token — re-login",
          { provider: appId, reauth: true }
        )
      );
    }
    return {
      ok: true,
      accessToken: stored.accessToken || stored.token,
      source: "store",
      refreshed: false,
    };
  }

  const key = String(appId);
  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const job = (async () => {
    try {
      const out = await refreshAppToken(cfg, appId, opts);
      if (!out.ok) return out;
      return {
        ok: true,
        accessToken: out.accessToken,
        source: out.source || "refresh",
        refreshed: true,
        rotated: out.rotated,
        expiresAt: out.expiresAt,
      };
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, job);
  return job;
}

/**
 * Drop inflight (tests).
 */
export function _resetInflightForTests() {
  inflight.clear();
}
