/**
 * Same class as queue cancel overwritten by a long-running writer:
 * dropMcpGrant persists a delete while resolveMcpAccessToken holds the
 * whole store across refreshMcpToken (network, AbortSignal.timeout 20s).
 * Save of the stale snapshot must not resurrect a dropped grant.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "os";
import {
  settleAfterMcpRefresh,
  resolveMcpAccessToken,
  storeMcpGrant,
  dropMcpGrant,
  loadMcpOAuthStore,
} from "../src/mcp/oauth.mjs";

describe("settleAfterMcpRefresh", () => {
  const held = () => ({
    alpha: { tokens: { accessToken: "new-a" } },
    beta: { tokens: { accessToken: "old-b" } },
  });

  it("does not resurrect a missing store", () => {
    assert.equal(settleAfterMcpRefresh(held(), null, "alpha"), null);
  });

  it("does not resurrect when held is missing", () => {
    assert.equal(
      settleAfterMcpRefresh(null, { alpha: { tokens: { accessToken: "x" } } }, "alpha"),
      null
    );
  });

  it("does not overwrite a drop of THIS server", () => {
    assert.equal(
      settleAfterMcpRefresh(held(), { beta: { tokens: { accessToken: "b" } } }, "alpha"),
      null
    );
  });

  it("overlays only this server so a drop of another survives", () => {
    const h = held();
    const next = settleAfterMcpRefresh(
      h,
      { alpha: { tokens: { accessToken: "old-a" } } },
      "alpha"
    );
    assert.deepEqual(next, { alpha: { tokens: { accessToken: "new-a" } } });
    assert.equal(next.beta, undefined);
  });

  it("returns overlay when on-disk still has this server", () => {
    const h = held();
    const onDisk = {
      alpha: { tokens: { accessToken: "old-a" } },
      beta: { tokens: { accessToken: "old-b" } },
    };
    const next = settleAfterMcpRefresh(h, onDisk, "alpha");
    assert.equal(next.alpha, h.alpha);
    assert.equal(next.beta, onDisk.beta);
  });
});

describe("resolveMcpAccessToken does not overwrite a concurrent drop", () => {
  let dir;
  let server;
  let origin;

  before(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-mcp-oauth-settle-"));
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

  function expiredGrant() {
    return {
      discovery: { tokenEndpoint: `${origin}/token`, resource: `${origin}/mcp` },
      clientId: "c1",
      tokens: {
        accessToken: "at-old",
        refreshToken: "rt-1",
        expiresAt: Date.now() - 1000,
      },
    };
  }

  it("leaves the grant gone when drop lands during refresh", async () => {
    const cfg = { paths: { configDir: dir } };
    storeMcpGrant(cfg, "alpha", expiredGrant());
    const resolveP = resolveMcpAccessToken(cfg, "alpha");
    await new Promise((r) => setTimeout(r, 200));
    dropMcpGrant(cfg, "alpha");
    const tok = await resolveP;
    assert.equal(tok, null);
    const onDisk = loadMcpOAuthStore(cfg);
    assert.equal(onDisk.alpha, undefined);
  });

  it("does not resurrect a different server dropped during refresh", async () => {
    const cfg = { paths: { configDir: dir } };
    storeMcpGrant(cfg, "alpha", expiredGrant());
    storeMcpGrant(cfg, "beta", {
      discovery: { tokenEndpoint: `${origin}/token`, resource: `${origin}/mcp` },
      clientId: "c2",
      tokens: { accessToken: "at-beta", refreshToken: "rt-b", expiresAt: Date.now() + 3600_000 },
    });
    const resolveP = resolveMcpAccessToken(cfg, "alpha");
    await new Promise((r) => setTimeout(r, 200));
    dropMcpGrant(cfg, "beta");
    const tok = await resolveP;
    assert.equal(tok, "at-new");
    const onDisk = loadMcpOAuthStore(cfg);
    assert.equal(onDisk.alpha?.tokens?.accessToken, "at-new");
    assert.equal(onDisk.beta, undefined);
  });

  it("is wired before saveMcpOAuthStore inside resolveMcpAccessToken", async () => {
    const src = await fsp.readFile(new URL("../src/mcp/oauth.mjs", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export async function resolveMcpAccessToken"));
    const end = body.indexOf("export function storeMcpGrant");
    const resolve = end > 0 ? body.slice(0, end) : body;
    const settle = resolve.indexOf("settleAfterMcpRefresh(");
    const save = resolve.indexOf("saveMcpOAuthStore(");
    assert.ok(settle >= 0, "settleAfterMcpRefresh called in resolve");
    assert.ok(save > settle, "save is after settle");
    assert.match(resolve, /if\s*\(\s*!settled\s*\)\s*return\s*null/);
  });
});
