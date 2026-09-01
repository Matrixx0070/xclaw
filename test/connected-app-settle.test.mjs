/**
 * Same class as queue cancel overwritten by a long-running writer:
 * refreshAppToken holds the THIS-app record across unbounded
 * refreshAccessToken then setAppToken. deleteAppToken / logoutConnected
 * are concurrent writers. Save of the held record must not resurrect a
 * deleted app. Overlay keeps other-app deletes.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "os";
import {
  settleAfterAppRefresh,
  refreshAppToken,
  _resetInflightForTests,
} from "../src/connected/token-refresh.mjs";
import {
  setAppToken,
  getAppToken,
  deleteAppToken,
  loadTokens,
} from "../src/connected/token-store.mjs";
import { logoutConnected, refreshConnectedOAuth } from "../src/connected/oauth-login.mjs";

describe("settleAfterAppRefresh", () => {
  const held = () => ({
    version: 1,
    apps: {
      github: { accessToken: "at-new", refreshToken: "rt-new" },
      google: { accessToken: "at-google-old" },
    },
  });
  const onDiskBoth = () => ({
    version: 1,
    apps: {
      github: { accessToken: "at-old", refreshToken: "rt-1" },
      google: { accessToken: "at-google-old" },
    },
  });

  it("does not resurrect when held is missing", () => {
    assert.equal(settleAfterAppRefresh(null, onDiskBoth(), "github"), null);
  });

  it("does not resurrect a missing store", () => {
    assert.equal(settleAfterAppRefresh(held(), null, "github"), null);
  });

  it("does not resurrect when held is missing this app", () => {
    const h = held();
    delete h.apps.github;
    assert.equal(settleAfterAppRefresh(h, onDiskBoth(), "github"), null);
  });

  it("does not overwrite a delete of THIS app", () => {
    assert.equal(
      settleAfterAppRefresh(
        held(),
        { version: 1, apps: { google: { accessToken: "at-google-old" } } },
        "github"
      ),
      null
    );
  });

  it("does not overwrite logout-all (empty apps)", () => {
    assert.equal(
      settleAfterAppRefresh(held(), { version: 1, apps: {} }, "github"),
      null
    );
  });

  it("overlays only this app so a delete of another survives", () => {
    const h = held();
    const next = settleAfterAppRefresh(
      h,
      {
        version: 1,
        apps: { github: { accessToken: "at-old", refreshToken: "rt-1" } },
      },
      "github"
    );
    assert.equal(next.apps.github.accessToken, "at-new");
    assert.equal(next.apps.google, undefined);
  });

  it("returns overlay when on-disk still has this app", () => {
    const h = held();
    const onDisk = onDiskBoth();
    const next = settleAfterAppRefresh(h, onDisk, "github");
    assert.equal(next.apps.github.accessToken, "at-new");
    assert.equal(next.apps.google.accessToken, "at-google-old");
  });
});

describe("refreshAppToken does not overwrite a concurrent delete", () => {
  let dir;
  let server;
  let origin;

  before(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-connected-app-settle-"));
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

  async function seed(cfg, appId = "github", extra = {}) {
    await setAppToken(cfg, appId, {
      accessToken: "at-old",
      refreshToken: "rt-1",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      clientId: "cid-test",
      tokenUrl: origin,
      source: "oauth_browser",
      ...extra,
    });
  }

  it("leaves the app gone when delete lands during refresh", async () => {
    _resetInflightForTests();
    const sub = path.join(dir, "delete-this");
    await fsp.mkdir(sub, { recursive: true });
    const cfg = { paths: { configDir: sub } };
    await seed(cfg);
    const refreshP = refreshAppToken(cfg, "github");
    await new Promise((r) => setTimeout(r, 200));
    await deleteAppToken(cfg, "github");
    const out = await refreshP;
    assert.equal(out.ok, false);
    assert.equal(out.code, "no_token");
    assert.equal(await getAppToken(cfg, "github"), null);
  });

  it("does not resurrect a different app deleted during refresh", async () => {
    _resetInflightForTests();
    const sub = path.join(dir, "delete-other");
    await fsp.mkdir(sub, { recursive: true });
    const cfg = { paths: { configDir: sub } };
    await seed(cfg, "github");
    await seed(cfg, "google");
    const refreshP = refreshAppToken(cfg, "github");
    await new Promise((r) => setTimeout(r, 200));
    await deleteAppToken(cfg, "google");
    const out = await refreshP;
    assert.equal(out.ok, true);
    assert.equal(out.accessToken, "at-new");
    assert.equal((await getAppToken(cfg, "github")).accessToken, "at-new");
    assert.equal(await getAppToken(cfg, "google"), null);
  });

  it("leaves the app gone when logoutConnected all lands during refresh", async () => {
    _resetInflightForTests();
    const sub = path.join(dir, "logout-all");
    await fsp.mkdir(sub, { recursive: true });
    const cfg = { paths: { configDir: sub } };
    await seed(cfg);
    const refreshP = refreshAppToken(cfg, "github");
    await new Promise((r) => setTimeout(r, 200));
    await logoutConnected(cfg, "all");
    const out = await refreshP;
    assert.equal(out.ok, false);
    assert.equal(out.code, "no_token");
    assert.equal(await getAppToken(cfg, "github"), null);
    const onDisk = await loadTokens(cfg);
    assert.deepEqual(onDisk.apps, {});
  });

  it("refreshConnectedOAuth does not resurrect a concurrent delete", async () => {
    _resetInflightForTests();
    const sub = path.join(dir, "connected-oauth");
    await fsp.mkdir(sub, { recursive: true });
    const cfg = { paths: { configDir: sub } };
    await seed(cfg);
    const refreshP = refreshConnectedOAuth(cfg, "github");
    await new Promise((r) => setTimeout(r, 200));
    await deleteAppToken(cfg, "github");
    const out = await refreshP;
    assert.equal(out.ok, false);
    assert.equal(out.code, "no_token");
    assert.equal(await getAppToken(cfg, "github"), null);
  });

  it("is wired before saveTokens inside persistRefreshedApp", async () => {
    const src = await fsp.readFile(
      new URL("../src/connected/token-refresh.mjs", import.meta.url),
      "utf8"
    );
    const persistStart = src.indexOf("async function persistRefreshedApp");
    const persistEnd = src.indexOf("export async function refreshAppToken");
    const persist = src.slice(persistStart, persistEnd);
    const settle = persist.indexOf("settleAfterAppRefresh(");
    const save = persist.indexOf("saveTokens(");
    assert.ok(settle >= 0, "settleAfterAppRefresh called in persistRefreshedApp");
    assert.ok(save > settle, "saveTokens is after settle");
    assert.match(persist, /if\s*\(\s*!settled\s*\)\s*return\s*null/);

    const refreshStart = src.indexOf("export async function refreshAppToken");
    const refreshEnd = src.indexOf("export async function invalidateAppTokens");
    const refresh = src.slice(refreshStart, refreshEnd);
    assert.ok(refresh.includes("persistRefreshedApp("), "refreshAppToken persists through persistRefreshedApp");
    assert.ok(!/await setAppToken\(/.test(refresh), "refresh no longer setAppToken after fetch");
    assert.match(refresh, /if\s*\(\s*!latest\s*\)/);

    const loginSrc = await fsp.readFile(
      new URL("../src/connected/oauth-login.mjs", import.meta.url),
      "utf8"
    );
    const connectedStart = loginSrc.indexOf("export async function refreshConnectedOAuth");
    const connectedEnd = loginSrc.indexOf("export async function connectedAuthStatus");
    const connected = loginSrc.slice(connectedStart, connectedEnd);
    assert.ok(connected.includes("refreshAppToken("), "refreshConnectedOAuth delegates to refreshAppToken");
    assert.ok(!/await setAppToken\(/.test(connected), "refreshConnectedOAuth no longer writes the held record");
  });
});
