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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mcpError } from "./shared.mjs";
import { createStdioTransport } from "./stdio-client.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_LIST_TTL_MS = 300_000;

/** Real package version for clientInfo (was hardcoded "3.77.0" and drifting). */
let _pkgVersion = null;
export function xclawVersion() {
  if (_pkgVersion) return _pkgVersion;
  try {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    _pkgVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  } catch {
    _pkgVersion = "0.0.0";
  }
  return _pkgVersion;
}

/**
 * Streamable HTTP transport (MCP 2025-03-26+). A POST may be answered with
 * plain JSON *or* an SSE stream carrying the response among other messages;
 * sessions ride the `Mcp-Session-Id` header and the negotiated version is
 * echoed as `MCP-Protocol-Version` after initialize. Legacy JSON-POST servers
 * keep working — their responses are just the plain-JSON branch.
 */
function createHttpTransport(server = {}, opts = {}) {
  const timeoutMs = Number(opts.requestTimeoutMs || 30_000);
  let nextId = 1;
  let sessionId = null;
  let negotiatedVersion = null; // set from the initialize result

  async function headers(hasBody) {
    const h = {
      Accept: "application/json, text/event-stream",
      ...(server.headers || {}),
    };
    // Auth precedence: static apiKey → stored OAuth grant (resolved lazily so
    // refreshes happen mid-session without reconnecting).
    if (server.apiKey) {
      h.Authorization = `Bearer ${server.apiKey}`;
    } else if (opts.resolveAuth) {
      try {
        const auth = await opts.resolveAuth(server);
        if (auth) h.Authorization = auth;
      } catch {
        /* no stored grant — request goes unauthenticated */
      }
    }
    if (hasBody) h["Content-Type"] = "application/json";
    if (sessionId) h["Mcp-Session-Id"] = sessionId;
    if (negotiatedVersion) h["MCP-Protocol-Version"] = negotiatedVersion;
    return h;
  }

  /** Read an SSE body until the JSON-RPC message with `id` arrives. */
  async function readSseResponse(r, id, signal) {
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        if (signal?.aborted) throw new Error("timeout");
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() || "";
        for (const frame of frames) {
          const dataLines = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim());
          if (!dataLines.length) continue;
          let msg;
          try {
            msg = JSON.parse(dataLines.join("\n"));
          } catch {
            continue;
          }
          if (msg?.id === id && ("result" in msg || "error" in msg)) {
            return msg;
          }
          // Other frames are server notifications/requests — surfaced to the
          // owner when an onServerMessage hook is wired (notifications slice).
          try {
            opts.onServerMessage?.(msg, server);
          } catch {}
        }
      }
      throw new Error(`SSE stream ended before response to id ${id}`);
    } finally {
      try {
        reader.cancel();
      } catch {}
    }
  }

  async function post(payload, { isNotification = false } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
    try {
      const r = await fetch(server.url, {
        method: "POST",
        signal: ctrl.signal,
        headers: await headers(true),
        body: JSON.stringify(payload),
      });
      if (r.status === 401) {
        throw new Error(
          `unauthorized (401) — server "${server.name}" needs credentials: set apiKey or run the MCP OAuth login`
        );
      }
      // Server-assigned session (typically on the initialize response)
      const sid = r.headers?.get?.("mcp-session-id");
      if (sid) sessionId = sid;
      if (r.status === 404 && sessionId) {
        // Session expired server-side — drop it so the next initialize
        // (client re-init path) starts a fresh one.
        sessionId = null;
        throw new Error("MCP session expired (404)");
      }
      if (isNotification) {
        // 202 Accepted (spec) or any 2xx — nothing to parse.
        if (!r.ok && r.status !== 202) {
          throw new Error(`notification rejected: HTTP ${r.status}`);
        }
        return null;
      }
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
      }
      const ct = String(r.headers?.get?.("content-type") || "");
      let msg;
      if (ct.includes("text/event-stream")) {
        msg = await readSseResponse(r, payload.id, ctrl.signal);
      } else {
        const body = await r.json();
        // Tolerate (removed-in-spec) batch arrays from older servers.
        msg = Array.isArray(body)
          ? body.find((m) => m?.id === payload.id) || body[0]
          : body;
      }
      if (msg?.error) {
        throw new Error(msg.error.message || JSON.stringify(msg.error));
      }
      return msg?.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(method, params = {}) {
    const result = await post({ jsonrpc: "2.0", id: nextId++, method, params });
    if (method === "initialize" && result?.protocolVersion) {
      negotiatedVersion = String(result.protocolVersion);
    }
    return result;
  }

  function notify(method, params = {}) {
    post({ jsonrpc: "2.0", method, params }, { isNotification: true }).catch(() => {});
  }

  return {
    request,
    notify,
    close: () => {
      // Best-effort session teardown (spec: DELETE ends the session).
      if (sessionId) {
        const sid = sessionId;
        sessionId = null;
        headers(false)
          .then((h) => fetch(server.url, { method: "DELETE", headers: { ...h, "Mcp-Session-Id": sid } }))
          .catch(() => {});
      }
    },
    kind: "http",
  };
}

/** Provider tool-name charset: [A-Za-z0-9_-], keep it stable + reversible enough. */
export function sanitizeMcpName(s) {
  return String(s || "").replace(/[^A-Za-z0-9_-]/g, "_");
}

export function createMcpClient(opts = {}) {
  // Live server list: getServers (a function) re-resolves on every call so a
  // config edit (UI/CLI add/remove) applies without recreating the client;
  // plain opts.servers keeps the old frozen-list behavior for tests/one-offs.
  const getServers = () =>
    (typeof opts.getServers === "function"
      ? opts.getServers() || []
      : opts.servers || []
    ).filter((s) => s && s.name);
  const listTtlMs = Number(opts.listTtlMs ?? DEFAULT_LIST_TTL_MS);
  const requestTimeoutMs = opts.requestTimeoutMs;
  // Stored OAuth grants (per server name) resolve lazily when cfg is known.
  const resolveAuth =
    opts.resolveAuth ||
    (opts.cfg
      ? async (server) => {
          const { resolveMcpAccessToken } = await import("./oauth.mjs");
          const tok = await resolveMcpAccessToken(opts.cfg, server.name);
          return tok ? `Bearer ${tok}` : null;
        }
      : null);

  /** @type {Map<string, {transport, initialized: boolean, tools: any[]|null, listedAt: number, error: string|null}>} */
  const conns = new Map();

  /**
   * Server → client traffic (notifications + surfaced requests):
   * tools/list_changed invalidates that server's tool cache so the next
   * listing refetches instead of serving the 5-min TTL copy.
   */
  function handleServerMessage(msg, server) {
    if (msg?.method === "notifications/tools/list_changed") {
      // Bump the generation instead of zeroing listedAt: the notification can
      // land in the same stdout chunk as a tools/list response, in which case
      // the still-awaiting listTools continuation would overwrite a zeroed
      // timestamp and lose the invalidation (observed as a flaky test).
      const c = conns.get(server?.name);
      if (c) c.gen = (c.gen || 0) + 1;
    }
    try {
      opts.onServerMessage?.(msg, server);
    } catch {}
  }

  function conn(server) {
    let c = conns.get(server.name);
    if (c) return c;
    const transport = server.command
      ? createStdioTransport(server, {
          requestTimeoutMs,
          onServerMessage: handleServerMessage,
        })
      : createHttpTransport(server, {
          requestTimeoutMs,
          resolveAuth,
          onServerMessage: handleServerMessage,
        });
    c = {
      transport,
      initialized: false,
      tools: null,
      listedAt: 0,
      error: null,
      gen: 0, // bumped by tools/list_changed; fetchGen records what a fetch saw
      fetchGen: 0,
    };
    conns.set(server.name, c);
    return c;
  }

  async function ensureInitialized(server, c) {
    if (c.initialized) return;
    try {
      await c.transport.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "xclaw", version: xclawVersion() },
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
      getServers().map(async (s) => {
        const c = conn(s);
        const fresh =
          c.tools && Date.now() - c.listedAt < listTtlMs && c.fetchGen === c.gen;
        if (fresh && !o.refresh) {
          out.push(...namespacedTools(s, c.tools));
          return;
        }
        try {
          await ensureInitialized(s, c);
          const genBefore = c.gen;
          const result = await c.transport.request("tools/list", {});
          c.tools = result?.tools || [];
          c.listedAt = Date.now();
          c.fetchGen = genBefore;
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
    const server = getServers().find((s) => s.name === t._mcp.server);
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

  /** Initialized request against one named server (resources/prompts/etc). */
  async function serverRequest(serverName, method, params = {}) {
    const s = getServers().find((x) => x.name === serverName);
    if (!s) throw new Error(`unknown MCP server ${serverName}`);
    const c = conn(s);
    await ensureInitialized(s, c);
    return c.transport.request(method, params);
  }

  /**
   * Resources across servers (or one). Servers without the resources
   * capability answer method-not-found — reported per server, not thrown.
   */
  async function listResources(serverName) {
    const targets = serverName
      ? getServers().filter((s) => s.name === serverName)
      : getServers();
    const out = [];
    await Promise.all(
      targets.map(async (s) => {
        try {
          const r = await serverRequest(s.name, "resources/list", {});
          for (const res of r?.resources || []) out.push({ server: s.name, ...res });
        } catch (err) {
          out.push({ server: s.name, error: err.message });
        }
      })
    );
    return out;
  }

  function readResource(serverName, uri) {
    return serverRequest(serverName, "resources/read", { uri });
  }

  async function listPrompts(serverName) {
    const targets = serverName
      ? getServers().filter((s) => s.name === serverName)
      : getServers();
    const out = [];
    await Promise.all(
      targets.map(async (s) => {
        try {
          const r = await serverRequest(s.name, "prompts/list", {});
          for (const pr of r?.prompts || []) out.push({ server: s.name, ...pr });
        } catch (err) {
          out.push({ server: s.name, error: err.message });
        }
      })
    );
    return out;
  }

  function getPrompt(serverName, name, args = {}) {
    return serverRequest(serverName, "prompts/get", { name, arguments: args });
  }

  /** Per-server connection status for doctor / gateway. */
  function status() {
    return getServers().map((s) => {
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
    const s = getServers().find((x) => x.name === server?.name) || server;
    const c = conn(s);
    return c.transport.request(method, params);
  }

  return {
    listTools,
    callTool,
    listResources,
    readResource,
    listPrompts,
    getPrompt,
    status,
    close,
    get servers() {
      return getServers();
    },
    rpc,
  };
}

export default { createMcpClient, sanitizeMcpName };
