/**
 * MCP stdio transport — OpenClaw tools-stdio-server pattern (no SDK).
 * Reads JSON-RPC lines from stdin, writes responses to stdout.
 */
import { createMcpServer } from "./server.mjs";

export async function runMcpStdio(opts = {}) {
  const server = createMcpServer(opts);
  process.stderr.write("[xclaw-mcp] stdio server ready\n");

  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (chunk) => {
    buf += chunk;
    // Content-Length framing OR newline-delimited JSON
    while (true) {
      if (buf.startsWith("Content-Length:")) {
        const m = buf.match(/^Content-Length:\s*(\d+)\r?\n\r?\n/);
        if (!m) break;
        const len = Number(m[1]);
        const headerLen = m[0].length;
        if (buf.length < headerLen + len) break;
        const body = buf.slice(headerLen, headerLen + len);
        buf = buf.slice(headerLen + len);
        await handleBody(server, body);
        continue;
      }
      const nl = buf.indexOf("\n");
      if (nl < 0) break;
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      await handleBody(server, line);
    }
  });

  process.stdin.on("end", () => process.exit(0));
}

async function handleBody(server, raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return;
  }
  const out = await server.handleRequest(body);
  // Notifications get NO reply (out === null) — replying is spec-invalid.
  if (out == null) return;
  // Spec stdio framing is newline-delimited JSON. The old Content-Length
  // (LSP-style) replies confused strict clients; our own stdio client reads
  // both, so this stays interoperable in both directions.
  process.stdout.write(JSON.stringify(out) + "\n");
}
