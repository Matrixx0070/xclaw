/**
 * Computer API contract tests — no full Chromium required.
 * Spins a minimal HTTP stand-in for /health shape.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  isComputerRunning,
  computerBaseUrl,
  getComputerStatus,
} from "../src/computer/manager.mjs";
import {
  verifyComputerAuth,
  computerAuthHeaders,
} from "../src/computer/auth.mjs";
import { createComputerClient } from "../src/agent/computer-client.mjs";

describe("computer contract", () => {
  let server;
  let port;
  const cfg = () => ({
    computer: { host: "127.0.0.1", port },
    paths: { configDir: "/tmp/xclaw-contract-test" },
  });

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "healthy", version: "contract-0" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((r) => server.close(r));
  });

  it("health shape accepted by isComputerRunning", async () => {
    assert.equal(await isComputerRunning(cfg()), true);
  });

  it("getComputerStatus reports healthy", async () => {
    const st = await getComputerStatus(cfg());
    assert.equal(st.healthy, true);
    assert.ok(st.url.includes(String(port)));
  });

  it("computerBaseUrl uses host port", () => {
    const u = computerBaseUrl(cfg());
    assert.equal(u, `http://127.0.0.1:${port}`);
  });
});

describe("computer auth", () => {
  it("rejects missing token when required", () => {
    const r = verifyComputerAuth({ computer: { authToken: "secret" } }, {});
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
  });
  it("accepts bearer", () => {
    const r = verifyComputerAuth(
      { computer: { authToken: "secret" } },
      { authorization: "Bearer secret" }
    );
    assert.equal(r.ok, true);
  });
  it("hmac verifies", () => {
    const cfg = { computer: { authToken: "secret", authHmac: true } };
    const body = { ping: 1 };
    const headers = computerAuthHeaders(cfg, body);
    const r = verifyComputerAuth(cfg, headers, body);
    assert.equal(r.ok, true);
  });
});
