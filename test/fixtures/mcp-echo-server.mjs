#!/usr/bin/env node
/**
 * Test fixture: minimal spec-shaped MCP stdio server.
 * Tools: echo (returns args), add (a+b). Newline-delimited JSON-RPC.
 */
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) handle(line);
  }
});
process.stdin.on("end", () => process.exit(0));

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function handle(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (id == null) return; // notification (e.g. notifications/initialized)
  if (method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "mcp-echo-fixture", version: "1.0.0" },
      },
    });
  }
  if (method === "tools/list") {
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echo the arguments back",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
            },
          },
          {
            name: "add",
            description: "Add two numbers",
            inputSchema: {
              type: "object",
              properties: { a: { type: "number" }, b: { type: "number" } },
              required: ["a", "b"],
            },
          },
        ],
      },
    });
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    if (name === "echo") {
      return send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: `echo:${args.text ?? ""}` }] },
      });
    }
    if (name === "add") {
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: String(Number(args.a) + Number(args.b)) }],
        },
      });
    }
    return send({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: `unknown tool ${name}` }], isError: true },
    });
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}
