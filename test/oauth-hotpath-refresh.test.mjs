import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  loginOAuthTokens,
  resolveProviderToken,
  clearAllProfiles,
} from "../src/auth/profiles.mjs";
import { resolveProviderRouteAsync } from "../src/providers/registry.mjs";

// Real bug found by Frank's "did auto-refresh work?" question (3.94.4):
// the auto-refresh LOGIC worked, but the running gateway never reached it for
// the ACTIVE provider. loadConfig caches the OAuth token into cfg.agent.apiKey
// at boot; both resolveProviderRouteAsync and resolveProviderToken then
// short-circuited on that static snapshot, so a gateway up past the ~8h token
// lifetime kept sending the dead cached token (the 2026-08-13 outage). The fix:
// when the active provider is OAuth-backed, bypass the cache (freshOAuth) so
// expiry is checked and the token refreshes near the boundary.

describe("hot-path OAuth refresh (active provider)", () => {
  let cfg;
  let dir;
  let origFetch;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-hotpath-"));
    // Mimic loadConfig's boot cache: the active OAuth token snapshotted into
    // cfg.agent.apiKey, with authMode=oauth marking it refreshable.
    cfg = {
      paths: { configDir: dir },
      agent: {
        id: "main",
        provider: "anthropic",
        model: "claude-sonnet-5",
      },
    };
    origFetch = global.fetch;
  });
  after(async () => {
    global.fetch = origFetch;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("refreshes a near-expiry active OAuth token instead of returning the stale boot cache", async () => {
    await clearAllProfiles(cfg);
    await loginOAuthTokens(cfg, {
      provider: "anthropic",
      name: "oauth",
      accessToken: "stale-boot-token",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 5_000, // 5s out → within the 30s refresh window
      setDefault: true,
      meta: { clientId: "test-client" },
    });

    // The exact boot-cache shape loadConfig produces for the active provider.
    const bootCfg = {
      ...cfg,
      agent: {
        ...cfg.agent,
        apiKey: "stale-boot-token",
        authMode: "oauth",
        authSource: "profile:anthropic:oauth",
        authProfileId: "anthropic:oauth",
      },
    };

    let tokenCall = null;
    global.fetch = async (url, opts) => {
      tokenCall = { url: String(url), body: opts?.body };
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            access_token: "REFRESHED-token",
            refresh_token: "refresh-2",
            expires_in: 28800,
          }),
        json: async () => ({
          access_token: "REFRESHED-token",
          refresh_token: "refresh-2",
          expires_in: 28800,
        }),
      };
    };

    const route = await resolveProviderRouteAsync(bootCfg, {
      provider: "anthropic",
      model: "claude-sonnet-5",
    });

    assert.ok(tokenCall, "the token endpoint was hit (refresh fired)");
    assert.match(route.apiKey || route.authSource ? String(route.authSource || "") : "", /refresh/);
    assert.equal(route.apiKey, "REFRESHED-token", "route must carry the freshly-minted token, not the boot cache");
  });

  it("does NOT refresh a healthy active OAuth token (no per-request storm)", async () => {
    await clearAllProfiles(cfg);
    await loginOAuthTokens(cfg, {
      provider: "anthropic",
      name: "oauth",
      accessToken: "healthy-token",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 8 * 3600_000, // ~8h out
      setDefault: true,
      meta: { clientId: "test-client" },
    });
    const bootCfg = {
      ...cfg,
      agent: {
        ...cfg.agent,
        apiKey: "healthy-token",
        authMode: "oauth",
        authSource: "profile:anthropic:oauth",
        authProfileId: "anthropic:oauth",
      },
    };
    let called = false;
    global.fetch = async () => {
      called = true;
      throw new Error("token endpoint must not be hit for a healthy token");
    };
    for (let i = 0; i < 3; i++) {
      const route = await resolveProviderRouteAsync(bootCfg, {
        provider: "anthropic",
        model: "claude-sonnet-5",
      });
      assert.equal(route.apiKey, "healthy-token");
    }
    assert.equal(called, false, "no refresh call for a healthy token");
  });

  it("freshOAuth option bypasses the cfg.agent.apiKey short-circuit", async () => {
    // Direct unit check of the resolveProviderToken flag the hot path relies on.
    await clearAllProfiles(cfg);
    await loginOAuthTokens(cfg, {
      provider: "anthropic",
      name: "oauth",
      accessToken: "profile-token",
      expiresAt: Date.now() + 8 * 3600_000,
      setDefault: true,
    });
    const bootCfg = {
      ...cfg,
      agent: { ...cfg.agent, apiKey: "CACHED", authMode: "oauth", authProfileId: "anthropic:oauth" },
    };
    // Without freshOAuth → returns the cached snapshot.
    const cached = await resolveProviderToken(bootCfg, "anthropic", {});
    assert.equal(cached.token, "CACHED");
    // With freshOAuth → skips the cache, resolves the profile token.
    const fresh = await resolveProviderToken(bootCfg, "anthropic", {
      freshOAuth: true,
      profileId: "anthropic:oauth",
    });
    assert.equal(fresh.token, "profile-token");
  });
});
