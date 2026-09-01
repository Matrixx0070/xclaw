/**
 * Same class as queue cancel overwritten by a long-running writer:
 * refreshProfileOAuth holds the whole auth-profiles.json store across
 * unbounded fetch then saveProfiles. removeProfile / loginApiKey /
 * loginToken / clearAllProfiles are concurrent writers. Save of the stale
 * whole-store snapshot must not resurrect a removed profile — or overwrite
 * a concurrent api_key. Overlay keeps other-profile removes.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "os";
import {
  settleAfterProfileRefresh,
  refreshProfileOAuth,
  loginOAuthTokens,
  loginApiKey,
  removeProfile,
  loadProfiles,
  clearAllProfiles,
  profilesPath,
} from "../src/auth/profiles.mjs";

describe("settleAfterProfileRefresh", () => {
  const held = () => ({
    version: 1,
    order: { xai: ["xai:default", "xai:work"] },
    profiles: {
      "xai:default": {
        provider: "xai",
        mode: "oauth",
        accessToken: "at-new",
        refreshToken: "rt-new",
      },
      "xai:work": {
        provider: "xai",
        mode: "oauth",
        accessToken: "at-work-old",
      },
    },
  });
  const onDiskBoth = () => ({
    version: 1,
    order: { xai: ["xai:default", "xai:work"] },
    profiles: {
      "xai:default": {
        provider: "xai",
        mode: "oauth",
        accessToken: "at-old",
        refreshToken: "rt-1",
      },
      "xai:work": {
        provider: "xai",
        mode: "oauth",
        accessToken: "at-work-old",
      },
    },
  });

  it("does not resurrect when held is missing", () => {
    assert.equal(settleAfterProfileRefresh(null, onDiskBoth(), "xai:default"), null);
  });

  it("does not resurrect a missing store", () => {
    assert.equal(settleAfterProfileRefresh(held(), null, "xai:default"), null);
  });

  it("does not resurrect when held is missing this id", () => {
    const h = held();
    delete h.profiles["xai:default"];
    assert.equal(settleAfterProfileRefresh(h, onDiskBoth(), "xai:default"), null);
  });

  it("does not overwrite a remove of THIS profile", () => {
    assert.equal(
      settleAfterProfileRefresh(
        held(),
        {
          version: 1,
          order: { xai: ["xai:work"] },
          profiles: {
            "xai:work": { provider: "xai", mode: "oauth", accessToken: "at-work-old" },
          },
        },
        "xai:default"
      ),
      null
    );
  });

  it("does not overwrite a concurrent non-oauth replacement", () => {
    assert.equal(
      settleAfterProfileRefresh(
        held(),
        {
          version: 1,
          order: { xai: ["xai:default"] },
          profiles: {
            "xai:default": { provider: "xai", mode: "api_key", apiKey: "xai-concurrent" },
          },
        },
        "xai:default"
      ),
      null
    );
  });

  it("overlays only this profile so a remove of another survives", () => {
    const h = held();
    const next = settleAfterProfileRefresh(
      h,
      {
        version: 1,
        order: { xai: ["xai:default"] },
        profiles: {
          "xai:default": {
            provider: "xai",
            mode: "oauth",
            accessToken: "at-old",
            refreshToken: "rt-1",
          },
        },
      },
      "xai:default"
    );
    assert.equal(next.profiles["xai:default"].accessToken, "at-new");
    assert.equal(next.profiles["xai:work"], undefined);
  });

  it("returns overlay when on-disk still has this profile", () => {
    const h = held();
    const onDisk = onDiskBoth();
    const next = settleAfterProfileRefresh(h, onDisk, "xai:default");
    assert.equal(next.profiles["xai:default"].accessToken, "at-new");
    assert.equal(next.profiles["xai:work"].accessToken, "at-work-old");
  });
});

describe("refreshProfileOAuth does not overwrite a concurrent remove", () => {
  let dir;
  let server;
  let origin;

  before(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-auth-profiles-settle-"));
    server = http.createServer(async (req, res) => {
      if (req.method === "POST") {
        await new Promise((r) => setTimeout(r, 1000));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            access_token: "at-new",
            refresh_token: "rt-new",
            expires_in: 3600,
            token_type: "Bearer",
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    origin = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    await fsp.rm(dir, { recursive: true, force: true });
  });

  async function seedOauth(cfg, { name = "default", extra } = {}) {
    await loginOAuthTokens(cfg, {
      provider: "xai",
      name,
      accessToken: "at-old",
      refreshToken: "rt-1",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      setDefault: true,
      meta: { clientId: "xclaw-cli", tokenUrl: origin },
      ...extra,
    });
  }

  it("leaves the profile gone when remove lands during refresh", async () => {
    const sub = path.join(dir, "remove-this");
    await fsp.mkdir(sub, { recursive: true });
    const cfg = { paths: { configDir: sub }, agent: { id: "main" } };
    await seedOauth(cfg);
    const store = await loadProfiles(cfg);
    const id = "xai:default";
    const profile = { ...store.profiles[id] };
    const refreshP = refreshProfileOAuth(cfg, store, id, profile);
    await new Promise((r) => setTimeout(r, 200));
    await removeProfile(cfg, id);
    const tok = await refreshP;
    assert.equal(tok, null);
    const onDisk = await loadProfiles(cfg);
    assert.equal(onDisk.profiles[id], undefined);
  });

  it("does not resurrect a different profile removed during refresh", async () => {
    const sub = path.join(dir, "remove-other");
    await fsp.mkdir(sub, { recursive: true });
    const cfg = { paths: { configDir: sub }, agent: { id: "main" } };
    await seedOauth(cfg, { name: "default" });
    await seedOauth(cfg, { name: "work" });
    const store = await loadProfiles(cfg);
    const id = "xai:default";
    const profile = { ...store.profiles[id] };
    const refreshP = refreshProfileOAuth(cfg, store, id, profile);
    await new Promise((r) => setTimeout(r, 200));
    await removeProfile(cfg, "xai:work");
    const tok = await refreshP;
    assert.equal(tok.accessToken, "at-new");
    const onDisk = await loadProfiles(cfg);
    assert.equal(onDisk.profiles[id].accessToken, "at-new");
    assert.equal(onDisk.profiles["xai:work"], undefined);
  });

  it("does not overwrite a concurrent loginApiKey on the same id", async () => {
    const sub = path.join(dir, "api-key");
    await fsp.mkdir(sub, { recursive: true });
    const cfg = { paths: { configDir: sub }, agent: { id: "main" } };
    await seedOauth(cfg);
    const store = await loadProfiles(cfg);
    const id = "xai:default";
    const profile = { ...store.profiles[id] };
    const refreshP = refreshProfileOAuth(cfg, store, id, profile);
    await new Promise((r) => setTimeout(r, 200));
    await loginApiKey(cfg, { provider: "xai", name: "default", apiKey: "xai-concurrent-key" });
    const tok = await refreshP;
    assert.equal(tok, null);
    const onDisk = await loadProfiles(cfg);
    assert.equal(onDisk.profiles[id].mode, "api_key");
    assert.equal(onDisk.profiles[id].apiKey, "xai-concurrent-key");
  });

  it("leaves the file gone when clearAllProfiles lands during refresh", async () => {
    const sub = path.join(dir, "clear-all");
    await fsp.mkdir(sub, { recursive: true });
    const cfg = { paths: { configDir: sub }, agent: { id: "main" } };
    await seedOauth(cfg);
    const fp = profilesPath(cfg);
    const store = await loadProfiles(cfg);
    const id = "xai:default";
    const profile = { ...store.profiles[id] };
    const refreshP = refreshProfileOAuth(cfg, store, id, profile);
    await new Promise((r) => setTimeout(r, 200));
    await clearAllProfiles(cfg);
    const tok = await refreshP;
    assert.equal(tok, null);
    assert.equal(fs.existsSync(fp), false);
  });

  it("is wired before saveProfiles inside persistRefreshedProfile", async () => {
    const src = await fsp.readFile(new URL("../src/auth/profiles.mjs", import.meta.url), "utf8");
    const persistStart = src.indexOf("async function persistRefreshedProfile");
    const persistEnd = src.indexOf("export async function credentialFromProfile");
    const persist = src.slice(persistStart, persistEnd);
    const settle = persist.indexOf("settleAfterProfileRefresh(");
    const save = persist.indexOf("saveProfiles(");
    assert.ok(settle >= 0, "settleAfterProfileRefresh called in persistRefreshedProfile");
    assert.ok(save > settle, "saveProfiles is after settle");
    assert.match(persist, /if\s*\(\s*!settled\s*\)\s*return\s*null/);

    const refreshStart = src.indexOf("export async function refreshProfileOAuth");
    const refreshEnd = src.indexOf("export async function resolveProviderToken");
    const refresh = src.slice(refreshStart, refreshEnd);
    assert.equal((refresh.match(/persistRefreshedProfile\(/g) || []).length, 2);
    assert.ok(
      !/await saveProfiles\(\s*cfg,\s*store\s*\)/.test(refresh),
      "refresh no longer saves the held store"
    );
  });
});
