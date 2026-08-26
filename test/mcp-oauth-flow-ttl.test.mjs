import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { tryHandleMcpRoute } from "../src/gateway/routes/mcp.mjs";

// Consume-time TTL on the in-flight MCP OAuth pending map (mcp.mjs).
//
// /mcp/oauth/callback is auth-exempt (gateway/auth.mjs:70) and its ONLY
// authentication is the one-time `state` bounded by a 10-min TTL (the handler
// comment says so). But gcPending() — the sweep enforcing that TTL — is called
// only in /mcp/oauth/start; the callback and complete consume handlers checked
// only `!flow`, never the age. A flow started, abandoned past the TTL, then
// completed with no intervening start was redeemable for the whole gateway
// lifetime — a captured state+code (logs, Referer, an interrupted redirect)
// reached the PKCE token exchange and stored a grant. The 10-min bound on an
// auth-exempt endpoint's sole credential was documented but never enforced at
// consume time (mutation-sweep #55).

let as;
let port;
let origin;
let tokenHits;
let TMP;

before(async () => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-mcp-ttl-"));
  as = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const send = (code, body) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (u.pathname === "/.well-known/oauth-protected-resource/mcp") {
      return send(200, {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ["mcp.read"],
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
      return send(201, { client_id: "dyn-client-1" });
    }
    if (u.pathname === "/token" && req.method === "POST") {
      tokenHits += 1;
      return send(200, {
        access_token: "at-STALE",
        refresh_token: "rt-STALE",
        expires_in: 3600,
        token_type: "Bearer",
      });
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

function mkCfg() {
  return {
    paths: { configDir: TMP },
    mcp: { servers: [{ name: "remote1", url: `${origin}/mcp` }] },
  };
}

// POST driver (start / complete) — captures json(res, code, payload).
function callPost(p, body, cfg) {
  let status = null;
  let out = null;
  return tryHandleMcpRoute({
    p,
    method: "POST",
    req: { headers: { host: "127.0.0.1:test" } },
    res: {},
    url: new URL("http://x" + p),
    cfg,
    json: (_res, code, payload) => {
      status = code;
      out = payload;
    },
    readBody: async () => body,
    mcpClient: { status: () => [] },
    mcpServer: {},
  }).then((handled) => ({ handled, status, out }));
}

// GET driver (callback) — captures res.writeHead(code) + res.end(html).
function callCallback(query, cfg) {
  let status = null;
  let html = "";
  return tryHandleMcpRoute({
    p: "/mcp/oauth/callback",
    method: "GET",
    req: { headers: {} },
    res: {
      writeHead: (c) => {
        status = c;
      },
      end: (b) => {
        html += b || "";
      },
    },
    url: new URL("http://x/mcp/oauth/callback?" + query),
    cfg,
    json: () => {},
    readBody: async () => ({}),
    mcpClient: { status: () => [] },
    mcpServer: {},
  }).then((handled) => ({ handled, status, html }));
}

async function startFrozen(cfg, T0) {
  const realNow = Date.now;
  try {
    Date.now = () => T0; // freeze so pending.startedAt === T0
    return await callPost("/mcp/oauth/start", { server: "remote1" }, cfg);
  } finally {
    Date.now = realNow;
  }
}

describe("MCP OAuth pending-flow TTL (consume-time)", () => {
  it("callback REJECTS an aged pending flow before the code exchange", async () => {
    const cfg = mkCfg();
    const realNow = Date.now;
    const T0 = realNow.call(Date);
    tokenHits = 0;

    const started = await startFrozen(cfg, T0);
    assert.equal(started.status, 200, JSON.stringify(started.out));
    const state = started.out.state;
    assert.ok(state && state.length >= 16);

    let done;
    try {
      Date.now = () => T0 + 11 * 60_000; // 11 min > 10 min TTL
      done = await callCallback(
        `state=${encodeURIComponent(state)}&code=good-code`,
        cfg
      );
    } finally {
      Date.now = realNow;
    }
    assert.equal(done.status, 400, "an aged pending flow must be rejected");
    assert.match(done.html, /Login link expired/);
    assert.equal(tokenHits, 0, "a stale flow must never reach the token exchange");
  });

  it("complete REJECTS an aged pending flow before the code exchange", async () => {
    const cfg = mkCfg();
    const realNow = Date.now;
    const T0 = realNow.call(Date);
    tokenHits = 0;

    const started = await startFrozen(cfg, T0);
    assert.equal(started.status, 200, JSON.stringify(started.out));
    const state = started.out.state;

    let done;
    try {
      Date.now = () => T0 + 11 * 60_000;
      done = await callPost(
        "/mcp/oauth/complete",
        { state, code: "good-code" },
        cfg
      );
    } finally {
      Date.now = realNow;
    }
    assert.equal(done.status, 400, "an aged pending flow must be rejected");
    assert.match(done.out.error, /unknown or expired state/);
    assert.equal(tokenHits, 0, "a stale flow must never reach the token exchange");
  });

  it("a FRESH flow still completes (guard does not over-reject)", async () => {
    const cfg = mkCfg();
    tokenHits = 0;
    const started = await callPost("/mcp/oauth/start", { server: "remote1" }, cfg);
    assert.equal(started.status, 200, JSON.stringify(started.out));
    const state = started.out.state;
    const done = await callPost(
      "/mcp/oauth/complete",
      { state, code: "good-code" },
      cfg
    );
    assert.equal(done.status, 200, JSON.stringify(done.out));
    assert.equal(done.out.ok, true);
    assert.equal(tokenHits, 1, "the fresh flow reached the exchange exactly once");
  });
});
