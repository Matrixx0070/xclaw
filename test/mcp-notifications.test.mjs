import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpClient } from "../src/mcp/client.mjs";

// Server → client traffic over stdio (2026-08-13 audit findings #5/#7):
//  - notifications/tools/list_changed must invalidate the tool cache (the TTL
//    cache used to serve stale lists for 5 minutes)
//  - a server-initiated `ping` REQUEST must be ANSWERED (the old handler
//    matched any id against pending client calls and dropped server requests)

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "mcp-stdio-fixture.mjs"
);

const messages = [];
const client = createMcpClient({
  servers: [{ name: "fix", command: process.execPath, args: [fixture] }],
  onServerMessage: (m) => messages.push(m.method),
});

after(() => client.close());

describe("MCP server-initiated traffic (stdio)", () => {
  it("list_changed invalidates cache; server ping gets answered", async () => {
    const first = await client.listTools();
    assert.deepEqual(
      first.filter((t) => t._mcp).map((t) => t._mcp.tool),
      ["alpha"]
    );

    // let the notification + ping frames arrive and the ping reply round-trip
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(
      messages.includes("notifications/tools/list_changed"),
      `saw list_changed (got: ${messages.join(", ")})`
    );

    // TTL is 5 min — without invalidation this second call would serve the
    // 1-tool cache. The fixture names the new tool after whether our client
    // answered its ping request.
    const second = await client.listTools();
    const names = second.filter((t) => t._mcp).map((t) => t._mcp.tool).sort();
    assert.deepEqual(names, ["alpha", "ping_yes"]);
  });
});
