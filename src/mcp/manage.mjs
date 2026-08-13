/**
 * MCP server config management — same pattern as providers/channels manage:
 * reads cfg, writes through saveConfigPatch, never echoes secrets back.
 *
 * Server entry shape (cfg.mcp.servers[]):
 *   { name, url, apiKey?, headers?, oauthClientId?, oauthScopes?,
 *     allowTools?, denyTools? }                     — Streamable HTTP remote
 *   { name, command, args?, env?, cwd?,
 *     allowTools?, denyTools? }                     — local stdio process
 */
import { saveConfigPatch } from "../config/load.mjs";
import { createMcpClient } from "./client.mjs";
import { loadMcpOAuthStore } from "./oauth.mjs";

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

function currentServers(cfg) {
  return Array.isArray(cfg?.mcp?.servers) ? cfg.mcp.servers : [];
}

/** Sanitized inventory — apiKey/env values are reported as booleans only. */
export function listMcpServers(cfg) {
  const grants = loadMcpOAuthStore(cfg);
  return currentServers(cfg).map((s) => ({
    name: s.name,
    transport: s.command ? "stdio" : "http",
    url: s.url || null,
    command: s.command || null,
    args: s.args || null,
    hasApiKey: Boolean(s.apiKey),
    hasOAuth: Boolean(grants[s.name]?.tokens?.accessToken),
    oauthExpiresAt: grants[s.name]?.tokens?.expiresAt || null,
    allowTools: s.allowTools || null,
    denyTools: s.denyTools || null,
  }));
}

function validateDef(def = {}) {
  if (!NAME_RE.test(def.name || "")) {
    throw new Error("name must be 1-64 chars of [a-zA-Z0-9_-], starting alphanumeric");
  }
  const hasUrl = typeof def.url === "string" && def.url.trim();
  const hasCmd = typeof def.command === "string" && def.command.trim();
  if (!hasUrl && !hasCmd) throw new Error("either url (remote) or command (stdio) is required");
  if (hasUrl && hasCmd) throw new Error("url and command are mutually exclusive");
  if (hasUrl) {
    const u = new URL(def.url); // throws on garbage
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(u.hostname);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) {
      throw new Error("url must be https (or http to loopback)");
    }
  }
  for (const k of ["allowTools", "denyTools", "args"]) {
    if (def[k] != null && !Array.isArray(def[k])) throw new Error(`${k} must be an array`);
  }
}

function cleanDef(def) {
  const out = { name: def.name.trim() };
  if (def.url) out.url = def.url.trim();
  if (def.command) out.command = def.command.trim();
  if (def.args?.length) out.args = def.args.map(String);
  if (def.env && typeof def.env === "object") out.env = def.env;
  if (def.cwd) out.cwd = String(def.cwd);
  if (def.apiKey) out.apiKey = String(def.apiKey);
  if (def.headers && typeof def.headers === "object") out.headers = def.headers;
  if (def.oauthClientId) out.oauthClientId = String(def.oauthClientId);
  if (def.oauthScopes?.length) out.oauthScopes = def.oauthScopes.map(String);
  if (def.allowTools?.length) out.allowTools = def.allowTools.map(String);
  if (def.denyTools?.length) out.denyTools = def.denyTools.map(String);
  return out;
}

/** Add (or replace with replace:true) a server. Returns the saved list (sanitized). */
export async function addMcpServer(cfg, def = {}, { replace = false } = {}) {
  validateDef(def);
  const servers = currentServers(cfg).slice();
  const idx = servers.findIndex((s) => s.name === def.name);
  if (idx >= 0 && !replace) throw new Error(`server "${def.name}" already exists`);
  const clean = cleanDef(def);
  if (idx >= 0) {
    // Preserve an existing stored apiKey when the update doesn't send one.
    if (!clean.apiKey && servers[idx].apiKey) clean.apiKey = servers[idx].apiKey;
    servers[idx] = clean;
  } else {
    servers.push(clean);
  }
  await saveConfigPatch({ mcp: { servers } });
  if (cfg.mcp) cfg.mcp.servers = servers; // keep the live cfg coherent
  else cfg.mcp = { servers };
  return { ok: true, note: "applies to new agent runs; restart channels to be sure" };
}

export async function removeMcpServer(cfg, name) {
  const servers = currentServers(cfg).filter((s) => s.name !== name);
  if (servers.length === currentServers(cfg).length) {
    throw new Error(`server "${name}" not found`);
  }
  await saveConfigPatch({ mcp: { servers } });
  if (cfg.mcp) cfg.mcp.servers = servers;
  return { ok: true };
}

/**
 * Live-test a server def (or a configured server by name): initialize +
 * tools/list with a bounded timeout; never throws.
 */
export async function testMcpServer(cfg, nameOrDef, { timeoutMs = 10_000 } = {}) {
  const def =
    typeof nameOrDef === "string"
      ? currentServers(cfg).find((s) => s.name === nameOrDef)
      : nameOrDef;
  if (!def) return { ok: false, error: "server not found" };
  const client = createMcpClient({ servers: [def], cfg, requestTimeoutMs: timeoutMs });
  try {
    const tools = await Promise.race([
      client.listTools({ refresh: true }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`test timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
    const usable = tools.filter((t) => t._mcp);
    const failure = tools.find((t) => t.error);
    if (!usable.length && failure) return { ok: false, error: failure.error };
    return {
      ok: true,
      toolCount: usable.length,
      tools: usable.slice(0, 25).map((t) => t._mcp.tool),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    client.close();
  }
}
