/**
 * MCP client — HTTP JSON-RPC (XClaw) + patterns aligned with OpenClaw MCP tool surface.
 */
import { mcpError } from "./shared.mjs";

export function createMcpClient(opts = {}) {
  const servers = opts.servers || []; // [{ name, url, apiKey }]

  async function rpc(server, method, params = {}) {
    const r = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(server.apiKey ? { Authorization: `Bearer ${server.apiKey}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
    });
    const body = await r.json();
    if (body.error) {
      throw new Error(body.error.message || JSON.stringify(body.error));
    }
    return body.result;
  }

  async function listTools() {
    const out = [];
    for (const s of servers) {
      try {
        const result = await rpc(s, "tools/list", {});
        const tools = result?.tools || [];
        for (const t of tools) {
          out.push({
            server: s.name,
            name: `mcp__${s.name}__${t.name}`,
            description: t.description || t.name,
            inputSchema: t.inputSchema || t.parameters || {},
            _mcp: { server: s.name, tool: t.name, url: s.url, apiKey: s.apiKey },
          });
        }
      } catch (err) {
        out.push({ server: s.name, error: err.message });
      }
    }
    return out;
  }

  async function callTool(fullName, args = {}) {
    // Prefer cached list
    const tools = await listTools();
    const t = tools.find((x) => x.name === fullName);
    if (!t?._mcp) {
      return mcpError(`Unknown MCP tool ${fullName}`);
    }
    const server = {
      name: t._mcp.server,
      url: t._mcp.url,
      apiKey: t._mcp.apiKey,
    };
    try {
      const result = await rpc(server, "tools/call", {
        name: t._mcp.tool,
        arguments: args,
      });
      if (result?.content) return result;
      return {
        content: [{ type: "text", text: JSON.stringify(result ?? null, null, 2) }],
        structuredContent: result,
      };
    } catch (err) {
      return mcpError(err.message || String(err));
    }
  }

  return { listTools, callTool, servers, rpc };
}
