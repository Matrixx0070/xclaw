import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpClient, sanitizeMcpName } from "../src/mcp/client.mjs";
import { createAgentMcpTools } from "../src/agent/mcp-tools.mjs";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/mcp-echo-server.mjs"
);

const stdioServer = {
  name: "echo",
  command: process.execPath,
  args: [fixture],
};

describe("MCP stdio client", () => {
  it("initializes, lists namespaced tools, calls them round-trip", async () => {
    const client = createMcpClient({ servers: [stdioServer] });
    try {
      const tools = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      assert.deepEqual(names, ["mcp__echo__add", "mcp__echo__echo"]);
      assert.equal(tools[0].inputSchema.type, "object");

      const echoed = await client.callTool("mcp__echo__echo", { text: "hi" });
      assert.equal(echoed.content[0].text, "echo:hi");

      const sum = await client.callTool("mcp__echo__add", { a: 2, b: 40 });
      assert.equal(sum.content[0].text, "42");

      const st = client.status();
      assert.equal(st[0].transport, "stdio");
      assert.equal(st[0].toolCount, 2);
      assert.equal(st[0].error, null);
    } finally {
      client.close();
    }
  });

  it("unknown tool returns isError result, not a throw", async () => {
    const client = createMcpClient({ servers: [stdioServer] });
    try {
      const out = await client.callTool("mcp__echo__nope", {});
      assert.equal(out.isError, true);
    } finally {
      client.close();
    }
  });

  it("dead command reports per-server error without failing listing", async () => {
    const client = createMcpClient({
      servers: [
        { name: "dead", command: process.execPath, args: ["-e", "process.exit(3)"] },
        stdioServer,
      ],
    });
    try {
      const tools = await client.listTools();
      const errRow = tools.find((t) => t.server === "dead" && t.error);
      assert.ok(errRow, "dead server should surface an error row");
      assert.ok(tools.some((t) => t.name === "mcp__echo__echo"));
    } finally {
      client.close();
    }
  });
});

describe("MCP http client", () => {
  let server;
  let url;
  let hits = 0;

  it("lists and calls over HTTP JSON-RPC, caching tools/list", async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const msg = JSON.parse(body);
        const ok = (result) =>
          res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
        if (msg.method === "initialize") return ok({ protocolVersion: "2025-06-18" });
        if (msg.method === "tools/list") {
          hits++;
          return ok({
            tools: [{ name: "ping", description: "pong", inputSchema: { type: "object" } }],
          });
        }
        if (msg.method === "tools/call") {
          return ok({ content: [{ type: "text", text: `pong:${msg.params.arguments.x}` }] });
        }
        res.end(
          JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "nf" } })
        );
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${server.address().port}/mcp`;

    const client = createMcpClient({ servers: [{ name: "web", url }] });
    try {
      const tools = await client.listTools();
      assert.equal(tools[0].name, "mcp__web__ping");
      const out = await client.callTool("mcp__web__ping", { x: "1" });
      assert.equal(out.content[0].text, "pong:1");
      // callTool + second listTools must reuse the cache (1 tools/list hit)
      await client.listTools();
      assert.equal(hits, 1);
      const refreshed = await client.listTools({ refresh: true });
      assert.equal(hits, 2);
      assert.equal(refreshed[0].name, "mcp__web__ping");
    } finally {
      client.close();
    }
  });

  after(() => server?.close());
});

describe("agent MCP adapter", () => {
  it("disabled with no servers", async () => {
    const m = await createAgentMcpTools({ cfg: {} });
    assert.equal(m.enabled, false);
    assert.equal(m.toolDefs.length, 0);
  });

  it("exposes OpenAI-style tool defs and dispatches", async () => {
    const events = [];
    const m = await createAgentMcpTools({
      cfg: { mcp: { servers: [stdioServer] } },
      onEvent: (e) => events.push(e),
    });
    try {
      assert.equal(m.enabled, true);
      assert.ok(m.names.has("mcp__echo__echo"));
      const def = m.toolDefs.find((t) => t.function.name === "mcp__echo__echo");
      assert.equal(def.type, "function");
      assert.match(def.function.description, /^\[MCP:echo\]/);
      assert.equal(def.function.parameters.type, "object");
      const out = await m.callTool("mcp__echo__echo", { text: "loop" });
      assert.equal(out.content[0].text, "echo:loop");
      assert.ok(events.some((e) => e.type === "mcp" && e.phase === "tools"));
    } finally {
      m.close();
    }
  });

  it("discovery failure never throws — run continues toolless", async () => {
    const events = [];
    const m = await createAgentMcpTools({
      cfg: {
        mcp: {
          servers: [{ name: "gone", url: "http://127.0.0.1:1/nope" }],
          listTimeoutMs: 1500,
        },
      },
      onEvent: (e) => events.push(e),
    });
    try {
      assert.equal(m.enabled, true);
      assert.equal(m.toolDefs.length, 0);
      assert.ok(
        events.some(
          (e) => e.type === "mcp" && (e.phase === "server_error" || e.phase === "discovery_error")
        )
      );
    } finally {
      m.close();
    }
  });
});

describe("loop wiring", () => {
  it("loop.mjs dispatches MCP tools and closes clients in finally", () => {
    const src = fs.readFileSync(new URL("../src/agent/loop.mjs", import.meta.url), "utf8");
    assert.match(src, /createAgentMcpTools\(\{ cfg, onEvent \}\)/);
    assert.match(src, /mcpTools\?\.names\?\.has\(name\)/);
    assert.match(src, /mcpTools\.callTool\(name, args\)/);
    assert.match(src, /mcpTools\?\.close\?\.\(\)/);
  });

  it("sanitizeMcpName keeps provider-safe charset", () => {
    assert.equal(sanitizeMcpName("my server/v1"), "my_server_v1");
    assert.equal(sanitizeMcpName("ok-name_2"), "ok-name_2");
  });
});
