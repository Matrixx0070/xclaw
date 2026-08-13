/**
 * Stdio MCP fixture for tests: newline-framed JSON-RPC server that
 *  - answers initialize/tools/list/tools/call
 *  - after the FIRST tools/list, emits notifications/tools/list_changed and a
 *    server-initiated `ping` REQUEST (id "srv-1")
 *  - the second tools/list result names a tool after whether the client
 *    answered that ping (`ping_yes` / `ping_no`) and grows the list to 2
 */
let listCalls = 0;
let pingAnswered = false;

const write = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    handle(m);
  }
});

function handle(m) {
  if (m.id === "srv-1") {
    // the client's reply to OUR ping request
    if (m.result) pingAnswered = true;
    return;
  }
  if (m.method === "initialize") {
    write({
      jsonrpc: "2.0",
      id: m.id,
      result: {
        protocolVersion: m.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "fixture-stdio", version: "1.0.0" },
      },
    });
    return;
  }
  if (m.id == null) return; // client notification — no reply
  if (m.method === "tools/list") {
    listCalls += 1;
    const tools =
      listCalls === 1
        ? [{ name: "alpha", description: "a", inputSchema: { type: "object" } }]
        : [
            { name: "alpha", description: "a", inputSchema: { type: "object" } },
            {
              name: pingAnswered ? "ping_yes" : "ping_no",
              description: "b",
              inputSchema: { type: "object" },
            },
          ];
    write({ jsonrpc: "2.0", id: m.id, result: { tools } });
    if (listCalls === 1) {
      write({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
      write({ jsonrpc: "2.0", id: "srv-1", method: "ping" });
    }
    return;
  }
  if (m.method === "tools/call") {
    write({
      jsonrpc: "2.0",
      id: m.id,
      result: { content: [{ type: "text", text: `ran:${m.params?.name}` }] },
    });
    return;
  }
  write({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "nf" } });
}
