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

// Real incident (2026-08-13): an anthropic:oauth token sat expired for ~9
// hours and every live call 401'd, because (1) anthropic-oauth.mjs writes
// expiresAt as a raw epoch-ms NUMBER but the staleness check used
// Date.parse(), which only understands strings and silently returns NaN on
// a number — so the token never looked expired — and (2) even a working
// check would have refreshed through xAI's OAuth endpoint (the generic
// fallback's default), not Anthropic's, for an anthropic profile.

describe("oauth token refresh — expiresAt shape + provider dispatch", () => {
  let cfg;
  let dir;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-oauth-refresh-"));
    cfg = { paths: { configDir: dir }, agent: { id: "main" } };
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("numeric expiresAt in the past is treated as expired (no refresh token → error, not a stale token)", async () => {
    await clearAllProfiles(cfg);
    await loginOAuthTokens(cfg, {
      provider: "openai",
      name: "numeric-expired",
      accessToken: "stale-access-token",
      expiresAt: Date.now() - 60_000, // raw number, like anthropic-oauth.mjs writes
      setDefault: true,
    });
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const r = await resolveProviderToken({ paths: cfg.paths, agent: { id: "main" } }, "openai");
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    // Before the fix, Date.parse(number) → NaN → comparison always false →
    // the stale token was returned as if valid. It must not be now.
    assert.notEqual(r.token, "stale-access-token");
    assert.ok(r.error, "expired token without a refresh token must surface an error");
  });

  it("numeric expiresAt in the future resolves without attempting refresh", async () => {
    await clearAllProfiles(cfg);
    await loginOAuthTokens(cfg, {
      provider: "openai",
      name: "numeric-fresh",
      accessToken: "fresh-access-token",
      expiresAt: Date.now() + 3_600_000,
      setDefault: true,
    });
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const r = await resolveProviderToken({ paths: cfg.paths, agent: { id: "main" } }, "openai");
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    assert.equal(r.token, "fresh-access-token");
    assert.equal(r.error, undefined);
  });

  it("string ISO expiresAt still works (existing behavior unchanged)", async () => {
    await clearAllProfiles(cfg);
    await loginOAuthTokens(cfg, {
      provider: "openai",
      name: "iso-expired",
      accessToken: "stale-iso-token",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      setDefault: true,
    });
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const r = await resolveProviderToken({ paths: cfg.paths, agent: { id: "main" } }, "openai");
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    assert.notEqual(r.token, "stale-iso-token");
    assert.ok(r.error);
  });

  it("an expired anthropic profile with a refresh token dispatches to Anthropic's token endpoint, not xAI's", async () => {
    await clearAllProfiles(cfg);
    await loginOAuthTokens(cfg, {
      provider: "anthropic",
      name: "oauth",
      accessToken: "stale-anthropic-token",
      refreshToken: "refresh-me",
      expiresAt: Date.now() - 60_000,
      setDefault: true,
    });

    const origFetch = global.fetch;
    let calledUrl = null;
    global.fetch = async (url, opts) => {
      calledUrl = String(url);
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            access_token: "refreshed-anthropic-token",
            refresh_token: "refresh-me-2",
            expires_in: 3600,
          }),
        json: async () => ({
          access_token: "refreshed-anthropic-token",
          refresh_token: "refresh-me-2",
          expires_in: 3600,
        }),
      };
    };
    try {
      const r = await resolveProviderToken(
        { paths: cfg.paths, agent: { id: "main" } },
        "anthropic"
      );
      assert.equal(r.token, "refreshed-anthropic-token");
      assert.match(r.source, /refresh$/);
      // Must NOT be the xAI generic default — that was the second half of
      // the real bug (wrong OAuth server entirely for an anthropic profile).
      assert.ok(
        !calledUrl.includes("auth.x.ai"),
        `expected an Anthropic token endpoint, got ${calledUrl}`
      );
      assert.match(calledUrl, /anthropic|claude/i);
    } finally {
      global.fetch = origFetch;
    }
  });
});
