/**
 * MCP client manager — connects configured servers to XClaw.
 *
 * Transports per server config:
 *   { name, url, apiKey? }                 → HTTP JSON-RPC POST
 *   { name, command, args?, env?, cwd? }   → stdio (spawned process)
 *
 * Does the MCP `initialize` handshake (tolerating minimal servers that skip
 * it), caches tools/list per server with a TTL, and namespaces tools as
 * `mcp__<server>__<tool>`.
 */
import { mcpError } from "./shared.mjs";
import { createStdioTransport } from "./stdio-client.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_LIST_TTL_MS = 300_000;

function createHttpTransport(server = {}, opts = {}) {
  const timeoutMs = Number(opts.requestTimeoutMs || 30_000);
  let nextId = 1;

  async function request(method, params = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
    try {
      const r = await fetch(server.url, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(server.apiKey ? { Authorization: `Bearer ${server.apiKey}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      });
      const body = await r.json();
      if (body.error) {
        throw new Error(body.error.message || JSON.stringify(body.error));
      }
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }

  function notify(method, params = {}) {
    // Best-effort; HTTP servers commonly ignore notifications
    request(method, params).catch(() => {});
  }

  return { request, notify, close: () => {}, kind: "http" };
}

/** Provider tool-name charset: [A-Za-z0-9_-], keep it stable + reversible enough. */
export function sanitizeMcpName(s) {
  return String(s || "").replace(/[^A-Za-z0-9_-]/g, "_");
}

export function createMcpClient(opts = {}) {
  const servers = (opts.servers || []).filter((s) => s && s.name);
  const listTtlMs = Number(opts.listTtlMs ?? DEFAULT_LIST_TTL_MS);
  const requestTimeoutMs = opts.requestTimeoutMs;

  /** @type {Map<string, {transport, initialized: boolean, tools: any[]|null, listedAt: number, error: string|null}>} */
  const conns = new Map();

  function conn(server) {
    let c = conns.get(server.name);
    if (c) return c;
    const transport = server.command
      ? createStdioTransport(server, { requestTimeoutMs })
      : createHttpTransport(server, { requestTimeoutMs });
    c = { transport, initialized: false, tools: null, listedAt: 0, error: null };
    conns.set(server.name, c);
    return c;
  }

  async function ensureInitialized(server, c) {
    if (c.initialized) return;
    try {
      await c.transport.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "xclaw", version: "3.77.0" },
      });
      c.transport.notify("notifications/initialized", {});
    } catch {
      // Minimal servers answer tools/list without a handshake — proceed.
    }
    c.initialized = true;
  }

  /**
   * Per-server tool filter: config `allowTools: ["a", …]` exposes ONLY those;
   * `denyTools: ["b", …]` hides those. Filtered tools never reach the agent,
   * the UI, or callTool (which resolves through this list).
   */
  function toolPermitted(server, rawName) {
    if (Array.isArray(server.allowTools) && server.allowTools.length) {
      if (!server.allowTools.includes(rawName)) return false;
    }
    if (Array.isArray(server.denyTools) && server.denyTools.includes(rawName)) {
      return false;
    }
    return true;
  }

  function namespacedTools(server, tools) {
    return (tools || [])
      .filter((t) => toolPermitted(server, t.name))
      .map((t) => ({
        server: server.name,
        name: `mcp__${sanitizeMcpName(server.name)}__${sanitizeMcpName(t.name)}`,
        description: t.description || t.name,
        inputSchema:
          t.inputSchema || t.parameters || { type: "object", properties: {} },
        annotations: t.annotations || null,
        outputSchema: t.outputSchema || null,
        _mcp: { server: server.name, tool: t.name },
      }));
  }

  /**
   * List tools across all servers. Per-server failures are reported as
   * `{ server, error }` rows instead of failing the whole listing.
   * @param {{ refresh?: boolean }} [o]
   */
  async function listTools(o = {}) {
    const out = [];
    await Promise.all(
      servers.map(async (s) => {
        const c = conn(s);
        const fresh = c.tools && Date.now() - c.listedAt < listTtlMs;
        if (fresh && !o.refresh) {
          out.push(...namespacedTools(s, c.tools));
          return;
        }
        try {
          await ensureInitialized(s, c);
          const result = await c.transport.request("tools/list", {});
          c.tools = result?.tools || [];
          c.listedAt = Date.now();
          c.error = null;
          out.push(...namespacedTools(s, c.tools));
        } catch (err) {
          c.error = err.message || String(err);
          // Serve stale cache over nothing
          if (c.tools) out.push(...namespacedTools(s, c.tools));
          else out.push({ server: s.name, error: c.error });
        }
      })
    );
    return out;
  }

  /**
   * Call a namespaced tool (`mcp__<server>__<tool>`).
   * Returns MCP-shaped `{ content: [...] }` results; errors as isError results.
   */
  async function callTool(fullName, args = {}) {
    const tools = await listTools();
    const t = tools.find((x) => x.name === fullName);
    if (!t?._mcp) {
      return mcpError(`Unknown MCP tool ${fullName}`);
    }
    const server = servers.find((s) => s.name === t._mcp.server);
    if (!server) return mcpError(`Unknown MCP server ${t._mcp.server}`);
    const c = conn(server);
    try {
      await ensureInitialized(server, c);
      const result = await c.transport.request("tools/call", {
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

  /** Per-server connection status for doctor / gateway. */
  function status() {
    return servers.map((s) => {
      const c = conns.get(s.name);
      return {
        name: s.name,
        transport: s.command ? "stdio" : "http",
        connected: Boolean(c),
        toolCount: c?.tools?.length ?? null,
        error: c?.error || null,
      };
    });
  }

  /** Kill stdio children, drop caches. */
  function close() {
    for (const [, c] of conns) {
      try {
        c.transport.close();
      } catch {
        /* */
      }
    }
    conns.clear();
  }

  // rpc kept for back-compat with existing gateway callers
  async function rpc(server, method, params = {}) {
    const s = servers.find((x) => x.name === server?.name) || server;
    const c = conn(s);
    return c.transport.request(method, params);
  }

  return { listTools, callTool, status, close, servers, rpc };
}

export default { createMcpClient, sanitizeMcpName };
