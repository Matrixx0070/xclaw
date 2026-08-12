import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { refreshAccessToken } from "../src/auth/oauth-browser.mjs";
import { encryptJson, decryptJson, resolveStoreKey } from "../src/connected/token-crypto.mjs";
import { setAppToken, getAppToken, deleteAppToken } from "../src/connected/token-store.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("P5 token refresh mock + crypto", () => {
  let server;
  let port;
  let refreshHits = 0;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/token") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          refreshHits += 1;
          if (refreshHits === 1) {
            res.writeHead(503, { "Retry-After": "0" });
            res.end(JSON.stringify({ error: "temporarily_unavailable" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              access_token: "new-access",
              refresh_token: "new-refresh",
              expires_in: 3600,
              token_type: "Bearer",
            })
          );
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
  });

  it("refreshAccessToken retries 503 then succeeds", async () => {
    refreshHits = 0;
    const out = await refreshAccessToken({
      tokenUrl: `http://127.0.0.1:${port}/token`,
      clientId: "cid",
      refreshToken: "old-rt",
      retry: { retries: 3, baseMs: 1, maxDelayMs: 5, strategy: "none" },
    });
    assert.equal(out.ok, true);
    assert.equal(out.accessToken, "new-access");
    assert.equal(out.refreshToken, "new-refresh");
    assert.ok(refreshHits >= 2);
  });

  it("encrypt/decrypt roundtrip", () => {
    process.env.XCLAW_TOKEN_STORE_KEY = "test-key-for-encryption-32chars!!";
    const key = resolveStoreKey({});
    const blob = encryptJson({ version: 1, apps: { github: { accessToken: "sec" } } }, key);
    const plain = decryptJson(blob, key);
    assert.equal(plain.apps.github.accessToken, "sec");
    delete process.env.XCLAW_TOKEN_STORE_KEY;
  });

  it("deleteAppToken removes entry", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-p5-"));
    const cfg = { paths: { configDir: dir } };
    await setAppToken(cfg, "github", { accessToken: "t" });
    assert.ok((await getAppToken(cfg, "github"))?.accessToken);
    await deleteAppToken(cfg, "github");
    assert.equal(await getAppToken(cfg, "github"), null);
  });
});
