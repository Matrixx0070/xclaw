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

/** Protocol revisions this server can speak (echoed back when requested). */
const SUPPORTED_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"];
const LATEST_VERSION = "2025-06-18";

/**
 * Handle a single JSON-RPC MCP message.
 * Returns `null` for notifications — JSON-RPC/MCP clients MUST NOT receive a
 * reply to a notification (the old handler replied, which is spec-invalid and
 * confuses strict clients).
 */
export async function handleMcpJsonRpc(handlers, body, ctx = {}) {
  const id = body?.id;
  const method = body?.method;
  const params = body?.params || {};
  const isNotification = id === undefined || id === null;

  if (isNotification) {
    // notifications/initialized, notifications/cancelled, … — accept silently.
    return null;
  }

  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => ({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });

  try {
    if (method === "initialize") {
      // Version negotiation: echo the client's revision when we support it,
      // otherwise answer with our latest (spec behavior).
      const requested = String(params.protocolVersion || "");
      const protocolVersion = SUPPORTED_VERSIONS.includes(requested)
        ? requested
        : LATEST_VERSION;
      return ok({
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          ...(handlers.listResources ? { resources: {} } : {}),
          ...(handlers.listPrompts ? { prompts: {} } : {}),
        },
        serverInfo: ctx.serverInfo || { name: "xclaw-mcp", version: "0.0.0" },
      });
    }
    if (method === "tools/list") {
      return ok(await handlers.listTools());
    }
    if (method === "tools/call") {
      return ok(await handlers.callTool(params));
    }
    if (method === "resources/list" && handlers.listResources) {
      return ok(await handlers.listResources(params));
    }
    if (method === "resources/read" && handlers.readResource) {
      return ok(await handlers.readResource(params));
    }
    if (method === "prompts/list" && handlers.listPrompts) {
      return ok(await handlers.listPrompts(params));
    }
    if (method === "ping") {
      return ok({});
    }
    return fail(-32601, `Method not found: ${method}`);
  } catch (err) {
    return fail(-32000, err.message || String(err));
  }
}
