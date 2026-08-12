/**
 * Adapted from OpenClaw (MIT) — plugin-tools-handlers / tools-stdio-server patterns
 * List/call tool handlers over JSON-RPC MCP subset.
 */
import { mcpTextResult, mcpError } from "./shared.mjs";

/**
 * @param {Array<{ name, description?, inputSchema?, execute }>} tools
 */
export function createMcpToolHandlers(tools = []) {
  const byName = new Map(tools.map((t) => [t.name, t]));

  async function listTools() {
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description || t.name,
        inputSchema: t.inputSchema || t.parameters || {
          type: "object",
          properties: {},
        },
      })),
    };
  }

  async function callTool(params = {}, signal) {
    const name = params.name;
    const args = params.arguments || params.args || {};
    const tool = byName.get(name);
    if (!tool) {
      return mcpError(`Unknown tool: ${name}`);
    }
    if (signal?.aborted) {
      return mcpError("aborted");
    }
    try {
      const result = await tool.execute(args, { signal });
      if (result?.content) return result;
      if (typeof result === "string") return mcpTextResult(result);
      return mcpTextResult(JSON.stringify(result ?? null, null, 2), {
        structuredContent: result,
      });
    } catch (err) {
      return mcpError(err.message || String(err));
    }
  }

  return { listTools, callTool, byName };
}

/**
 * Handle a single JSON-RPC MCP request body.
 */
export async function handleMcpJsonRpc(handlers, body) {
  const id = body?.id ?? null;
  const method = body?.method;
  const params = body?.params || {};

  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => ({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });

  try {
    if (method === "initialize") {
      return ok({
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "xclaw-mcp", version: "0.6.0" },
      });
    }
    if (method === "notifications/initialized" || method === "initialized") {
      return ok({});
    }
    if (method === "tools/list") {
      return ok(await handlers.listTools());
    }
    if (method === "tools/call") {
      return ok(await handlers.callTool(params));
    }
    if (method === "ping") {
      return ok({});
    }
    return fail(-32601, `Method not found: ${method}`);
  } catch (err) {
    return fail(-32000, err.message || String(err));
  }
}
