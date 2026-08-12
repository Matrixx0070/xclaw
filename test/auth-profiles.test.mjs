import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  loginApiKey,
  loginToken,
  loginOAuthTokens,
  listProfiles,
  resolveProviderToken,
  setAuthOrder,
  getAuthOrder,
  removeProfile,
  modelsAuthStatus,
  clearAllProfiles,
  profilesPath,
} from "../src/auth/profiles.mjs";

describe("auth profiles", () => {
  let cfg;
  let dir;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-profiles-"));
    cfg = { paths: { configDir: dir }, agent: { id: "main" } };
  });

  after(async () => {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it("stores api key profile and resolves it first", async () => {
    await clearAllProfiles(cfg);
    const out = await loginApiKey(cfg, { provider: "xai", apiKey: "xai-profile-key-1" });
    assert.equal(out.ok, true);
    assert.equal(out.profileId, "xai:default");
    const r = await resolveProviderToken({ paths: cfg.paths, agent: { id: "main" } }, "xai");
    assert.equal(r.token, "xai-profile-key-1");
    assert.match(r.source, /profile:xai:default/);
  });

  it("respects profile order", async () => {
    await loginApiKey(cfg, { provider: "xai", name: "default", apiKey: "key-default", setDefault: true });
    await loginApiKey(cfg, { provider: "xai", name: "work", apiKey: "key-work", setDefault: false });
    await setAuthOrder(cfg, "xai", ["xai:work", "xai:default"]);
    const order = await getAuthOrder(cfg, "xai");
    assert.deepEqual(order.order, ["xai:work", "xai:default"]);
    const r = await resolveProviderToken({ paths: cfg.paths, agent: { id: "main" } }, "xai");
    assert.equal(r.token, "key-work");
  });

  it("lists redacted profiles", async () => {
    const list = await listProfiles(cfg, "xai");
    assert.ok(list.length >= 1);
    assert.equal(list[0].hasSecret, true);
    assert.ok(!("apiKey" in list[0]));
  });

  it("stores token mode", async () => {
    await loginToken(cfg, { provider: "anthropic", token: "setup-token-xyz" });
    const r = await resolveProviderToken({ paths: cfg.paths, agent: { id: "main" } }, "anthropic");
    assert.equal(r.token, "setup-token-xyz");
    assert.equal(r.mode, "token");
  });

  it("oauth expired without refresh returns error", async () => {
    await loginOAuthTokens(cfg, {
      provider: "openai",
      name: "expired",
      accessToken: "old",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      setDefault: true,
    });
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const r2 = await resolveProviderToken({ paths: cfg.paths, agent: { id: "main" } }, "openai");
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    assert.equal(r2.token, null);
    assert.ok(r2.error);
  });

  it("remove profile works", async () => {
    await loginApiKey(cfg, { provider: "openrouter", apiKey: "or-key" });
    const rm = await removeProfile(cfg, "openrouter:default");
    assert.equal(rm.ok, true);
    const list = await listProfiles(cfg, "openrouter");
    assert.equal(list.length, 0);
  });

  it("modelsAuthStatus returns structure", async () => {
    const st = await modelsAuthStatus(cfg, "xai");
    assert.ok(st.providers);
    assert.equal(st.providers[0].provider, "xai");
    assert.ok(st.path.includes("auth-profiles.json"));
  });

  it("config.agent.apiKey wins over profile", async () => {
    await loginApiKey(cfg, { provider: "xai", apiKey: "profile-key" });
    const r = await resolveProviderToken(
      { paths: cfg.paths, agent: { id: "main", apiKey: "config-wins", provider: "xai" } },
      "xai"
    );
    assert.equal(r.token, "config-wins");
    assert.equal(r.source, "config.agent.apiKey");
  });

  it("writes file with restrictive path under agents/", async () => {
    const fp = profilesPath(cfg);
    assert.ok(fp.includes(`${path.sep}agents${path.sep}`));
    assert.ok(fp.endsWith("auth-profiles.json"));
  });
});
