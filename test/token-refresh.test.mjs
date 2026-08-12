import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  isTokenExpired,
  needsRefresh,
  ensureFreshToken,
  _resetInflightForTests,
  DEFAULT_SKEW_MS,
} from "../src/connected/token-refresh.mjs";
import { setAppToken, loadTokens, saveTokens } from "../src/connected/token-store.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("token refresh logic", () => {
  beforeEach(() => _resetInflightForTests());

  it("isTokenExpired respects skew", () => {
    const now = Date.parse("2026-01-01T12:00:00Z");
    const expiresAt = new Date(now + 2 * 60 * 1000).toISOString(); // 2 min left
    assert.equal(isTokenExpired({ expiresAt }, now, DEFAULT_SKEW_MS), true); // within 5m skew
    assert.equal(isTokenExpired({ expiresAt }, now, 60_000), false); // 1m skew
    assert.equal(isTokenExpired({ expiresAt: null }, now), false);
  });

  it("needsRefresh requires refreshToken", () => {
    const expiresAt = new Date(Date.now() - 1000).toISOString();
    assert.equal(needsRefresh({ accessToken: "a", expiresAt }), false);
    assert.equal(
      needsRefresh({ accessToken: "a", refreshToken: "r", expiresAt }),
      true
    );
  });

  it("ensureFreshToken uses env without store", async () => {
    process.env.GITHUB_TOKEN = "env-pat-test";
    const r = await ensureFreshToken({}, "github");
    assert.equal(r.ok, true);
    assert.equal(r.source, "env");
    assert.equal(r.accessToken, "env-pat-test");
    delete process.env.GITHUB_TOKEN;
  });

  it("ensureFreshToken returns store token when not expired", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-tok-"));
    const cfg = { paths: { configDir: dir } };
    await setAppToken(cfg, "github", {
      accessToken: "alive",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const r = await ensureFreshToken(cfg, "github");
    assert.equal(r.ok, true);
    assert.equal(r.accessToken, "alive");
    assert.equal(r.refreshed, false);
  });
});
