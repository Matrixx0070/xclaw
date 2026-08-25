/**
 * Every declared gateway route is protected unless it is on an explicit,
 * justified open-list.
 *
 * The gate in auth.mjs is default-ALLOW: isProtectedPath returns false for
 * anything not matched by a list. That single property is why every bypass
 * recorded in auth.mjs was structurally inevitable — /v1 (3.190.0), the computer
 * plane (3.190.0), /ws/voice (3.191.0), /artifacts/file (3.192.0), /channel and
 * /approvals (3.193.0) were each a route the router served and no list named. A
 * unit test that asserts a list agrees with the list; it cannot notice a route
 * the list forgot.
 *
 * This test inverts the default. It walks routes-map.mjs — the gateway's own
 * declared inventory — and requires every route to be protected on a default
 * token gateway, EXCEPT the paths named in OPEN below, each with the reason it
 * is safe to serve without the operator token. Adding a route to routes-map
 * without protecting it, or widening the gate to open a declared route, fails
 * here with the offending path. The open-list is the audit surface: it is short
 * and every line has to earn its place.
 *
 * Honest limit: routes-map does not declare every served path — /agent-runs,
 * /artifacts/file, /ws/voice and the /v1/* aliases are absent — so this catches
 * the class only for declared routes. The undeclared ones are pinned separately
 * at the bottom, and closing the declaration gap is the real structural fix
 * (tracked, not done here).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGatewayAuth } from "../src/gateway/auth.mjs";
import { listRoutes } from "../src/gateway/routes-map.mjs";

const TOKEN = "tok-coverage";

/**
 * Paths a default token gateway serves without the operator token, each with the
 * reason it is safe. Anything here is deliberately reachable by anyone who can
 * reach the port; keep it minimal and keep every reason true.
 */
const OPEN = {
  "/health": "liveness probe, no data",
  "/ready": "readiness probe, no data",
  "/version": "build string, public",
  "/metrics": "Prometheus scrape; token-gated only when gateway.protectMetrics",
  "/chat/": "webchat UI page; public unless gateway.publicUi:false (own test)",
  "/control/": "control UI page; public unless gateway.publicUi:false (own test)",
  "/jwks.json": "public JWKS document — public keys only",
  "/xclaw/jwks.json": "public JWKS document — public keys only",
  "/.well-known/jwks.json": "public JWKS document — public keys only",
  // Self-authenticating in the handler, so the token-gate leaves it open:
  // stop-route.mjs runs authorizeStop (gateway token by default + optional
  // dedicated stop token + optional HMAC) and fails closed under requireAuth/prod.
  "/stop": "handler runs authorizeStop; fails closed in prod",
  "/xclaw/stop": "handler runs authorizeStop; fails closed in prod",
  // The MCP OAuth AS redirect: the authorization server sends the browser here
  // with ?code&state. It authenticates by the state it issued, never the
  // operator token, so the token-gate must leave it open — while every other
  // /mcp path (agent + data plane) stays protected. gateway-auth-cost-usage
  // pins the sibling OAuth POSTs protected; this one alone is open.
  "/mcp/oauth/callback": "MCP OAuth AS browser redirect; state-authenticated, not token-authenticated",
};

describe("gateway route coverage: no declared route is open by omission", () => {
  const auth = createGatewayAuth({ gateway: { token: TOKEN } });
  const routes = listRoutes();

  it("has a non-trivial inventory to check", () => {
    assert.ok(routes.length >= 60, `routes-map shrank unexpectedly (${routes.length})`);
  });

  for (const r of routes) {
    it(`${r.method} ${r.path} — ${Object.hasOwn(OPEN, r.path) ? "open (justified)" : "protected"}`, () => {
      const protectedNow = auth.isProtectedPath(r.path);
      if (Object.hasOwn(OPEN, r.path)) {
        assert.equal(
          protectedNow,
          false,
          `${r.path} is open-listed ("${OPEN[r.path]}") but the gate now protects it — drop it from OPEN`
        );
      } else {
        assert.equal(
          protectedNow,
          true,
          `${r.path} is a declared route with no operator-token protection and no justified OPEN entry. ` +
            `Protect it in auth.mjs, or add it to OPEN with the reason it is safe unauthenticated.`
        );
      }
    });
  }

  it("OPEN has no dead entries (every open-listed path is actually declared)", () => {
    const declared = new Set(routes.map((r) => r.path));
    for (const p of Object.keys(OPEN)) {
      assert.ok(declared.has(p), `OPEN lists ${p} but routes-map no longer declares it — remove it`);
    }
  });
});

describe("undeclared-but-served paths the same drift already reached", () => {
  // routes-map omits these, so the coverage loop above cannot see them. They are
  // exactly the routes prior sweeps found open; pin them so a regression here is
  // caught even though the declaration gap is still open.
  const auth = createGatewayAuth({ gateway: { token: TOKEN } });
  for (const p of ["/agent-runs", "/artifacts/file", "/channel/webchat/message"]) {
    it(`${p} is protected`, () => {
      assert.equal(auth.isProtectedPath(p), true, `${p} regressed to open`);
    });
  }
  it("/channel/telegram/webhook stays open (self-verifying)", () => {
    // The one /channel path that authenticates itself with Telegram's secret.
    assert.equal(auth.isProtectedPath("/channel/telegram/webhook"), false);
  });
});
