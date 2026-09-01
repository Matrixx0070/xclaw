/**
 * Same class as queue cancel overwritten by a long-running writer:
 * logout() unlinks credentials.json while refreshOAuthToken holds the prior
 * snapshot across unbounded fetch then saveCredentials. Save of the stale
 * vault must not resurrect a revoked login. Overlay keeps a concurrent
 * loginWithApiKey (xaiApiKey) on the same file.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "os";
import {
  settleAfterCredsRefresh,
  refreshOAuthToken,
  logout,
  loginWithApiKey,
} from "../src/auth/xai.mjs";

describe("settleAfterCredsRefresh", () => {
  const held = () => ({
    accessToken: "at-new",
    refreshToken: "rt-new",
    tokenType: "Bearer",
    expiresAt: "2099-01-01T00:00:00.000Z",
    oauth: { clientId: "c", tokenUrl: "http://t" },
    updatedAt: "2099-01-01T00:00:00.000Z",
  });
  const prior = () => ({
    accessToken: "at-old",
    refreshToken: "rt-1",
    tokenType: "Bearer",
    oauth: { clientId: "c", tokenUrl: "http://t" },
  });

  it("does not resurrect when held is missing", () => {
    assert.equal(settleAfterCredsRefresh(null, prior(), prior()), null);
  });

  it("does not resurrect a logout when a prior vault existed", () => {
    assert.equal(settleAfterCredsRefresh(held(), null, prior()), null);
  });

  it("allows first write when no prior vault existed", () => {
    const h = held();
    assert.equal(settleAfterCredsRefresh(h, null, null), h);
  });

  it("overlays oauth fields so a concurrent xaiApiKey survives", () => {
    const h = held();
    const onDisk = { ...prior(), xaiApiKey: "xai-concurrent" };
    const next = settleAfterCredsRefresh(h, onDisk, prior());
    assert.equal(next.xaiApiKey, "xai-concurrent");
    assert.equal(next.accessToken, "at-new");
    assert.equal(next.refreshToken, "rt-new");
    assert.equal(next.oauth.clientId, "c");
  });

  it("returns overlay when on-disk still has the prior vault", () => {
    const h = held();
    const next = settleAfterCredsRefresh(h, prior(), prior());
    assert.equal(next.accessToken, "at-new");
    assert.equal(next.refreshToken, "rt-new");
  });
});

describe("refreshOAuthToken does not overwrite a concurrent logout", () => {
  let dir;
  let server;
  let origin;

  before(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-xai-creds-settle-"));
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

  it("leaves credentials.json gone when logout lands during refresh", async () => {
    const cfg = { paths: { configDir: dir } };
    const fp = path.join(dir, "credentials.json");
    const creds = {
      accessToken: "at-old",
      refreshToken: "rt-1",
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      oauth: { clientId: "xclaw-cli", tokenUrl: origin },
    };
    await fsp.writeFile(fp, JSON.stringify(creds) + "\n", { mode: 0o600 });
    const refreshP = refreshOAuthToken(cfg, { ...creds });
    await new Promise((r) => setTimeout(r, 200));
    await logout(cfg);
    const tok = await refreshP;
    assert.equal(tok, null);
    assert.equal(fs.existsSync(fp), false);
  });

  it("keeps a concurrent loginWithApiKey when refresh lands after", async () => {
    const sub = path.join(dir, "overlay");
    await fsp.mkdir(sub, { recursive: true });
    const cfg = { paths: { configDir: sub } };
    const fp = path.join(sub, "credentials.json");
    const creds = {
      accessToken: "at-old",
      refreshToken: "rt-1",
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      oauth: { clientId: "xclaw-cli", tokenUrl: origin },
    };
    await fsp.writeFile(fp, JSON.stringify(creds) + "\n", { mode: 0o600 });
    const refreshP = refreshOAuthToken(cfg, { ...creds });
    await new Promise((r) => setTimeout(r, 200));
    await loginWithApiKey(cfg, "xai-concurrent-key");
    const tok = await refreshP;
    assert.equal(tok.accessToken, "at-new");
    assert.equal(tok.xaiApiKey, "xai-concurrent-key");
    const onDisk = JSON.parse(await fsp.readFile(fp, "utf8"));
    assert.equal(onDisk.xaiApiKey, "xai-concurrent-key");
    assert.equal(onDisk.accessToken, "at-new");
  });

  it("is wired before saveCredentials inside refreshOAuthToken", async () => {
    const src = await fsp.readFile(new URL("../src/auth/xai.mjs", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export async function refreshOAuthToken"));
    const refresh = body;
    const settle = refresh.indexOf("settleAfterCredsRefresh(");
    const save = refresh.indexOf("saveCredentials(");
    assert.ok(settle >= 0, "settleAfterCredsRefresh called in refreshOAuthToken");
    assert.ok(save > settle, "saveCredentials is after settle");
    assert.match(refresh, /if\s*\(\s*!settled\s*\)\s*return\s*null/);
  });
});
