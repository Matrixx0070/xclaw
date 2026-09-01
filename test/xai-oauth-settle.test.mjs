/**
 * Same class as queue cancel overwritten by a long-running writer:
 * logoutXai unlinks auth.json while refreshXaiToken holds the prior
 * snapshot across unbounded fetch then writeTokens. Save of the stale
 * vault must not resurrect a revoked login.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "os";
import {
  settleAfterXaiRefresh,
  refreshXaiToken,
  logoutXai,
} from "../src/auth/xai-oauth.mjs";

describe("settleAfterXaiRefresh", () => {
  const held = () => ({
    access_token: "at-new",
    refresh_token: "rt-new",
  });
  const prior = () => ({
    access_token: "at-old",
    refresh_token: "rt-1",
  });

  it("does not resurrect when held is missing", () => {
    assert.equal(settleAfterXaiRefresh(null, prior(), prior()), null);
  });

  it("does not resurrect a logout when a prior vault existed", () => {
    assert.equal(settleAfterXaiRefresh(held(), null, prior()), null);
  });

  it("allows first write when no prior vault existed", () => {
    const h = held();
    assert.equal(settleAfterXaiRefresh(h, null, null), h);
  });

  it("does not overwrite a concurrent login that rotated the refresh token", () => {
    assert.equal(
      settleAfterXaiRefresh(held(), { refresh_token: "rt-other" }, prior()),
      null
    );
  });

  it("returns held when on-disk still has the prior refresh token", () => {
    const h = held();
    assert.equal(settleAfterXaiRefresh(h, prior(), prior()), h);
  });
});

describe("refreshXaiToken does not overwrite a concurrent logout", () => {
  let dir;
  let server;
  let origin;

  before(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-xai-oauth-settle-"));
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

  it("leaves auth.json gone when logout lands during refresh", async () => {
    const cfg = {
      paths: { configDir: dir },
      auth: { xai: { authHost: origin } },
    };
    const fp = path.join(dir, "auth.json");
    await fsp.writeFile(
      fp,
      JSON.stringify({
        access_token: "at-old",
        refresh_token: "rt-1",
        token_type: "Bearer",
        expires_at: Date.now() - 1000,
      }) + "\n",
      { mode: 0o600 }
    );
    const refreshP = refreshXaiToken({ refresh_token: "rt-1" }, cfg);
    await new Promise((r) => setTimeout(r, 200));
    await logoutXai(cfg);
    const tok = await refreshP;
    assert.equal(tok, null);
    assert.equal(fs.existsSync(fp), false);
  });

  it("is wired before writeTokens inside refreshXaiToken", async () => {
    const src = await fsp.readFile(new URL("../src/auth/xai-oauth.mjs", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export async function refreshXaiToken"));
    const end = body.indexOf("function normalizeTokenResponse");
    const refresh = end > 0 ? body.slice(0, end) : body;
    const settle = refresh.indexOf("settleAfterXaiRefresh(");
    const write = refresh.indexOf("writeTokens(");
    assert.ok(settle >= 0, "settleAfterXaiRefresh called in refreshXaiToken");
    assert.ok(write > settle, "writeTokens is after settle");
    assert.match(refresh, /if\s*\(\s*!settled\s*\)\s*return\s*null/);
  });
});
