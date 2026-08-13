import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createMcpClient } from "../src/mcp/client.mjs";

// Streamable HTTP transport (MCP 2025-03-26+) against a REAL http server that
// enforces the spec mechanics the old JSON-POST transport lacked:
//   - Mcp-Session-Id assigned on initialize, REQUIRED on later requests
//   - MCP-Protocol-Version header echoed after negotiation
//   - tools/list answered as an SSE stream (with an unrelated notification
//     frame first), tools/call answered as plain JSON — mixed mode
//   - notifications answered 202 with no body

let server;
let port;
const seen = { sessionHeaders: [], versionHeaders: [], deletes: 0 };
const SESSION = "sess-abc-123";

before(async () => {
  server = http.createServer(async (req, res) => {
    if (req.method === "DELETE") {
      seen.deletes += 1;
      res.writeHead(200).end();
      return;
    }
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || "{}");
    seen.sessionHeaders.push(req.headers["mcp-session-id"] || null);
    seen.versionHeaders.push(req.headers["mcp-protocol-version"] || null);

    if (body.method === "initialize") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Mcp-Session-Id": SESSION,
      });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1.0.0" },
          },
        })
      );
      return;
    }
    if (body.id == null) {
      // notification → 202, no body (spec)
      res.writeHead(202).end();
      return;
    }
    if (req.headers["mcp-session-id"] !== SESSION) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unknown session" }));
      return;
    }
    if (body.method === "tools/list") {
      // SSE response with CRLF line endings (what DeepWiki actually sends —
      // an \n-only parser never terminates a frame): an unrelated
      // notification frame, then the real response.
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        `event: message\r\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/message",
          params: { level: "info", data: "hello" },
        })}\r\n\r\n`
      );
      res.write(
        `event: message\r\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: [{ name: "echo", description: "echoes", inputSchema: { type: "object" } }] },
        })}\r\n\r\n`
      );
      res.end();
      return;
    }
    if (body.method === "tools/call") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: `echo:${body.params.arguments.msg}` }] },
        })
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});

after(() => server.close());

describe("Streamable HTTP transport", () => {
  it("initialize captures session + version; SSE and JSON responses both work", async () => {
    const client = createMcpClient({
      servers: [{ name: "fix", url: `http://127.0.0.1:${port}/mcp` }],
    });

    const tools = await client.listTools();
    const usable = tools.filter((t) => t._mcp);
    assert.equal(usable.length, 1);
    assert.equal(usable[0].name, "mcp__fix__echo");

    const out = await client.callTool("mcp__fix__echo", { msg: "hi" });
    assert.equal(out.content[0].text, "echo:hi");

    // Session header: absent on initialize, present afterwards
    assert.equal(seen.sessionHeaders[0], null, "no session on initialize");
    assert.ok(
      seen.sessionHeaders.slice(1).every((s) => s === SESSION),
      `session echoed after init: ${JSON.stringify(seen.sessionHeaders)}`
    );
    // Negotiated protocol version echoed after initialize (notification +
    // tools/list + tools/call). The notifications/initialized notify may race
    // ahead of the initialize response — tolerate null there.
    const postInit = seen.versionHeaders.slice(1);
    assert.ok(
      postInit.filter((v) => v === "2025-06-18").length >= 2,
      `MCP-Protocol-Version after negotiation: ${JSON.stringify(seen.versionHeaders)}`
    );

    client.close();
    // DELETE teardown is fire-and-forget — give it a beat
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(seen.deletes, 1, "session DELETE sent on close");
  });
});
