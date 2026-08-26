/**
 * Gateway MCP HTTP routes (split from routes/api.mjs).
 *
 * Paths:
 *   POST /mcp · /mcp/call
 *   GET  /mcp/tools · /mcp/status
 *   POST /mcp/oauth/start · /mcp/oauth/complete   GET /mcp/oauth/callback (open)
 *   GET  /mcp/oauth/status                        DELETE /mcp/oauth
 */

/** In-flight OAuth flows keyed by state (single gateway process). */
const pendingOAuth = new Map();
const OAUTH_FLOW_TTL_MS = 10 * 60_000;

function gcPending() {
  const now = Date.now();
  for (const [state, f] of pendingOAuth) {
    if (now - f.startedAt > OAUTH_FLOW_TTL_MS) pendingOAuth.delete(state);
  }
}

async function completeOAuthFlow(cfg, flow, code) {
  const { exchangeMcpAuthCode, storeMcpGrant } = await import("../../mcp/oauth.mjs");
  const tokens = await exchangeMcpAuthCode(flow.discovery, {
    clientId: flow.clientId,
    redirectUri: flow.redirectUri,
    code,
    verifier: flow.verifier,
  });
  storeMcpGrant(cfg, flow.server, {
    discovery: flow.discovery,
    clientId: flow.clientId,
    tokens,
  });
  return tokens;
}

/** @param {object} args — standard route args + mcpClient, mcpServer (live deps)
 *  @returns {Promise<boolean>} true if handled */
export async function tryHandleMcpRoute({ p, method, req, res, url, cfg, json, readBody, mcpClient, mcpServer }) {
  if (p === "/mcp/oauth/start" && method === "POST") {
    gcPending();
    const body = await readBody(req).catch(() => ({}));
    const server = (cfg?.mcp?.servers || []).find((s) => s?.name === body.server);
    if (!server?.url) {
      json(res, 400, { error: "unknown MCP server (url servers only)" });
      return true;
    }
    try {
      const { discoverMcpAuth, registerMcpClient, buildMcpAuthorizeUrl } = await import(
        "../../mcp/oauth.mjs"
      );
      const discovery = await discoverMcpAuth(server.url);
      const host = req.headers?.host || `127.0.0.1:${cfg?.gateway?.port || 8790}`;
      const scheme = cfg?.gateway?.tls?.cert ? "https" : "http";
      const redirectUri = `${scheme}://${host}/mcp/oauth/callback`;
      const clientId =
        server.oauthClientId ||
        (await registerMcpClient(discovery, { redirectUri })).clientId;
      const { authorizeUrl, verifier, state } = buildMcpAuthorizeUrl(discovery, {
        clientId,
        redirectUri,
        scopes: server.oauthScopes,
      });
      pendingOAuth.set(state, {
        server: server.name,
        discovery,
        clientId,
        redirectUri,
        verifier,
        startedAt: Date.now(),
      });
      json(res, 200, { ok: true, authorizeUrl, state, redirectUri });
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }
  if (p === "/mcp/oauth/callback" && method === "GET") {
    // Browser redirect from the authorization server — authenticated by the
    // one-time `state` (random, 10-min TTL), not the operator token.
    gcPending(); // enforce that TTL at consume time — /start alone leaves aged flows redeemable
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    const flow = pendingOAuth.get(state);
    // This endpoint is auth-exempt and the failure branch renders e.message,
    // which can carry a remote AS's error_description — escape everything
    // interpolated into the page (flagged by security review: XSS).
    const escHtml = (s) =>
      String(s ?? "").replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
      );
    const html = (title, sub) =>
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#0d1117;color:#e6edf3;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:3rem">🦞</div><h2>${escHtml(title)}</h2><p style="opacity:.7">${escHtml(sub)}</p></div></body>`;
    if (!flow || !code) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html("Login link expired", "Start the MCP OAuth login again from XClaw."));
      return true;
    }
    try {
      await completeOAuthFlow(cfg, flow, code);
      pendingOAuth.delete(state);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html("MCP server authorized", `"${flow.server}" is connected — you can close this tab.`));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html("Authorization failed", e.message));
    }
    return true;
  }
  if (p === "/mcp/oauth/complete" && method === "POST") {
    // Paste-code path for headless setups.
    gcPending(); // enforce the 10-min TTL at consume time — /start alone leaves aged flows redeemable
    const body = await readBody(req).catch(() => ({}));
    const flow = pendingOAuth.get(body.state || "");
    if (!flow) {
      json(res, 400, { error: "unknown or expired state" });
      return true;
    }
    try {
      await completeOAuthFlow(cfg, flow, String(body.code || "").trim());
      pendingOAuth.delete(body.state);
      json(res, 200, { ok: true, server: flow.server });
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }
  if (p === "/mcp/oauth/status" && method === "GET") {
    const { loadMcpOAuthStore } = await import("../../mcp/oauth.mjs");
    const store = loadMcpOAuthStore(cfg);
    json(res, 200, {
      grants: Object.entries(store).map(([name, e]) => ({
        server: name,
        expiresAt: e.tokens?.expiresAt || null,
        hasRefresh: Boolean(e.tokens?.refreshToken),
        updatedAt: e.updatedAt || null,
      })),
    });
    return true;
  }
  if (p === "/mcp/oauth" && method === "DELETE") {
    const body = await readBody(req).catch(() => ({}));
    const { dropMcpGrant } = await import("../../mcp/oauth.mjs");
    dropMcpGrant(cfg, String(body.server || ""));
    json(res, 200, { ok: true });
    return true;
  }
  if (p === "/mcp/status" && method === "GET") {
    json(res, 200, { servers: mcpClient.status() });
    return true;
  }
  if (p === "/mcp/servers" && method === "GET") {
    const { listMcpServers } = await import("../../mcp/manage.mjs");
    json(res, 200, { servers: listMcpServers(cfg) });
    return true;
  }
  if (p === "/mcp/servers" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const { addMcpServer } = await import("../../mcp/manage.mjs");
    try {
      json(res, 200, await addMcpServer(cfg, body, { replace: body.replace === true }));
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }
  if (p === "/mcp/servers" && method === "DELETE") {
    const body = await readBody(req).catch(() => ({}));
    const { removeMcpServer } = await import("../../mcp/manage.mjs");
    try {
      json(res, 200, await removeMcpServer(cfg, String(body.name || "")));
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }
  if (p === "/mcp/servers/test" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const { testMcpServer } = await import("../../mcp/manage.mjs");
    json(res, 200, await testMcpServer(cfg, body.name || body.def || body));
    return true;
  }
  if (p === "/mcp/resources" && method === "GET") {
    json(res, 200, { resources: await mcpClient.listResources(url.searchParams.get("server") || undefined) });
    return true;
  }
  if (p === "/mcp/resources/read" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    try {
      json(res, 200, await mcpClient.readResource(body.server, body.uri));
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }
  if (p === "/mcp/prompts" && method === "GET") {
    json(res, 200, { prompts: await mcpClient.listPrompts(url.searchParams.get("server") || undefined) });
    return true;
  }
  if (p === "/mcp/prompts/get" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    try {
      json(res, 200, await mcpClient.getPrompt(body.server, body.name, body.arguments || {}));
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }
  if (p === "/mcp" && method === "POST") {
    const body = await readBody(req);
    const out = await mcpServer.handleRequest(body);
    json(res, 200, out);
    return true;
  }
  if (p === "/mcp/tools" && method === "GET") {
    const tools = await mcpClient.listTools();
    json(res, 200, { tools });
    return true;
  }
  if (p === "/mcp/call" && method === "POST") {
    const body = await readBody(req);
    const out = await mcpClient.callTool(body.name, body.arguments || body.args || {});
    json(res, 200, out);
    return true;
  }

  return false;
}

export default { tryHandleMcpRoute };
