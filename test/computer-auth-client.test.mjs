
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createComputerClient } from "../src/agent/computer-client.mjs";
import { verifyComputerAuth } from "../src/computer/auth.mjs";

describe("computer client auth headers", () => {
  let server;
  let port;
  let lastHeaders = {};

  before(async () => {
    server = http.createServer((req, res) => {
      lastHeaders = { ...req.headers };
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const cfg = { computer: { authToken: "tok-123" } };
        const v = verifyComputerAuth(cfg, req.headers, body ? JSON.parse(body) : null);
        if (!v.ok) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "healthy" }));
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  after(() => new Promise((r) => server.close(r)));

  it("sends token and succeeds", async () => {
    const client = createComputerClient({
      computer: { host: "127.0.0.1", port, authToken: "tok-123" },
    });
    const h = await client.health();
    assert.equal(h.status, "healthy");
    assert.ok(String(lastHeaders.authorization || "").includes("tok-123"));
  });

  it("fails without token against protected server", async () => {
    const client = createComputerClient({
      computer: { host: "127.0.0.1", port },
    });
    await assert.rejects(() => client.health());
  });
});
