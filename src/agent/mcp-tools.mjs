/**
 * MCP → agent loop adapter.
 *
 * Discovers tools from configured MCP servers (cfg.mcp.servers) and exposes
 * them to runAgentLoop as OpenAI-style tool defs plus a dispatcher. MCP tool
 * calls flow through the SAME in-loop security path as every other tool
 * (sandbox/egress/approval run before dispatch by name), and results come
 * back MCP-shaped ({ content: [...] }) which the loop already renders.
 *
 * Config:
 *   mcp.servers: [{ name, url, apiKey? } | { name, command, args?, env?, cwd? }]
 *   mcp.enabled: false to disable (default: enabled when servers exist)
 *   mcp.listTimeoutMs: discovery budget per loop start (default 8000)
 *   mcp.requestTimeoutMs: per-request transport timeout (default 30000)
 */
import { createMcpClient } from "../mcp/client.mjs";

const DEFAULT_LIST_TIMEOUT_MS = 8_000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * @param {{ cfg: object, onEvent?: Function }} opts
 * @returns {Promise<{ enabled: boolean, toolDefs: any[], names: Set<string>, callTool: Function, close: Function }>}
 */
export async function createAgentMcpTools({ cfg = {}, onEvent = () => {} } = {}) {
  const servers = cfg.mcp?.servers || [];
  const enabled = cfg.mcp?.enabled !== false && servers.length > 0;
  if (!enabled) {
    return {
      enabled: false,
      toolDefs: [],
      names: new Set(),
      callTool: async () => null,
      close: () => {},
    };
  }

  const client = createMcpClient({
    servers,
    cfg, // enables stored OAuth grants for url servers
    requestTimeoutMs: cfg.mcp?.requestTimeoutMs,
    listTtlMs: cfg.mcp?.listTtlMs,
  });

  const listTimeoutMs = Number(cfg.mcp?.listTimeoutMs || DEFAULT_LIST_TIMEOUT_MS);
  let discovered = [];
  try {
    discovered = await withTimeout(client.listTools(), listTimeoutMs, "MCP discovery");
  } catch (err) {
    // Discovery failure must never kill the run — report and continue toolless
    onEvent({ type: "mcp", phase: "discovery_error", message: err.message });
  }

  const usable = discovered.filter((t) => t?._mcp && t.name);
  const failures = discovered.filter((t) => t?.error);
  for (const f of failures) {
    onEvent({ type: "mcp", phase: "server_error", server: f.server, message: f.error });
  }
  if (usable.length) {
    onEvent({
      type: "mcp",
      phase: "tools",
      count: usable.length,
      names: usable.map((t) => t.name),
    });
  }

  const names = new Set(usable.map((t) => t.name));
  const toolDefs = usable.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: `[MCP:${t.server}] ${t.description}`.slice(0, 1024),
      parameters:
        t.inputSchema && typeof t.inputSchema === "object"
          ? t.inputSchema
          : { type: "object", properties: {} },
    },
  }));

  async function callTool(name, args = {}) {
    return client.callTool(name, args);
  }

  return { enabled: true, toolDefs, names, callTool, close: () => client.close() };
}

export default { createAgentMcpTools };
