import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  discoverMcpAuth,
  registerMcpClient,
  buildMcpAuthorizeUrl,
  exchangeMcpAuthCode,
  resolveMcpAccessToken,
  storeMcpGrant,
  loadMcpOAuthStore,
} from "../src/mcp/oauth.mjs";

// OAuth 2.1 for remote MCP servers against a REAL mock AS implementing:
// RFC 9728 protected-resource metadata → RFC 8414 AS metadata → RFC 7591
// dynamic registration → PKCE code exchange → refresh grant.

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-mcpoauth-"));
const cfg = { paths: { configDir: TMP } };

let as;
let port;
let origin;
const issued = { registrations: 0, exchanges: [], refreshes: 0 };

before(async () => {
  as = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const send = (code, body, ct = "application/json") => {
      res.writeHead(code, { "Content-Type": ct });
      res.end(JSON.stringify(body));
    };
    if (u.pathname === "/.well-known/oauth-protected-resource/mcp") {
      return send(200, {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ["mcp.read", "mcp.write"],
      });
    }
    if (u.pathname === "/.well-known/oauth-authorization-server") {
      return send(200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (u.pathname === "/register" && req.method === "POST") {
      issued.registrations += 1;
      return send(201, { client_id: "dyn-client-1" });
    }
    if (u.pathname === "/token" && req.method === "POST") {
      let raw = "";
      for await (const c of req) raw += c;
      const params = new URLSearchParams(raw);
      if (params.get("grant_type") === "authorization_code") {
        issued.exchanges.push(Object.fromEntries(params));
        if (params.get("code") !== "good-code" || !params.get("code_verifier")) {
          return send(400, { error: "invalid_grant" });
        }
        return send(200, {
          access_token: "at-1",
          refresh_token: "rt-1",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      if (params.get("grant_type") === "refresh_token") {
        issued.refreshes += 1;
        if (params.get("refresh_token") !== "rt-1") return send(400, { error: "invalid_grant" });
        return send(200, { access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 });
      }
      return send(400, { error: "unsupported_grant_type" });
    }
    send(404, { error: "nf" });
  });
  await new Promise((r) => as.listen(0, "127.0.0.1", r));
  port = as.address().port;
  origin = `http://127.0.0.1:${port}`;
});

after(() => {
  as.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("MCP OAuth 2.1", () => {
  it("discovery walks RFC9728 → RFC8414", async () => {
    const d = await discoverMcpAuth(`${origin}/mcp`);
    assert.equal(d.authorizationEndpoint, `${origin}/authorize`);
    assert.equal(d.tokenEndpoint, `${origin}/token`);
    assert.equal(d.registrationEndpoint, `${origin}/register`);
    assert.equal(d.resource, `${origin}/mcp`);
    assert.deepEqual(d.scopes, ["mcp.read", "mcp.write"]);
  });

  it("dynamic registration + PKCE authorize URL + code exchange + store + refresh", async () => {
    const d = await discoverMcpAuth(`${origin}/mcp`);
    const { clientId } = await registerMcpClient(d, {
      redirectUri: "http://127.0.0.1:1/cb",
    });
    assert.equal(clientId, "dyn-client-1");

    const { authorizeUrl, verifier, state } = buildMcpAuthorizeUrl(d, {
      clientId,
      redirectUri: "http://127.0.0.1:1/cb",
    });
    const au = new URL(authorizeUrl);
    assert.equal(au.searchParams.get("code_challenge_method"), "S256");
    assert.equal(au.searchParams.get("resource"), `${origin}/mcp`);
    assert.ok(au.searchParams.get("code_challenge"));
    assert.ok(state.length >= 16);

    const tokens = await exchangeMcpAuthCode(d, {
      clientId,
      redirectUri: "http://127.0.0.1:1/cb",
      code: "good-code",
      verifier,
    });
    assert.equal(tokens.accessToken, "at-1");
    assert.equal(issued.exchanges[0].code_verifier, verifier);
    assert.equal(issued.exchanges[0].resource, `${origin}/mcp`);

    storeMcpGrant(cfg, "remote1", { discovery: d, clientId, tokens });
    // store is 0600 and holds the grant
    const mode = fs.statSync(path.join(TMP, "mcp-oauth.json")).mode & 0o777;
    assert.equal(mode, 0o600);

    // fresh token resolves without refresh
    assert.equal(await resolveMcpAccessToken(cfg, "remote1"), "at-1");
    assert.equal(issued.refreshes, 0);

    // force expiry → refresh path rotates tokens and persists
    const store = loadMcpOAuthStore(cfg);
    store.remote1.tokens.expiresAt = Date.now() - 1000;
    fs.writeFileSync(path.join(TMP, "mcp-oauth.json"), JSON.stringify(store));
    assert.equal(await resolveMcpAccessToken(cfg, "remote1"), "at-2");
    assert.equal(issued.refreshes, 1);
    assert.equal(loadMcpOAuthStore(cfg).remote1.tokens.refreshToken, "rt-2");
  });

  it("unknown server resolves null (no grant)", async () => {
    assert.equal(await resolveMcpAccessToken(cfg, "nope"), null);
  });
});
