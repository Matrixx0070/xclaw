/**
 * Every path the ROUTER serves is protected unless it is on an explicit,
 * justified open-list. This is the structural close of the gap the route-
 * coverage test left open.
 *
 * gateway-route-coverage.test.mjs walks routes-map.mjs — the gateway's *declared*
 * inventory — and its own header names the limit: routes-map does not declare
 * every served path (~106 of ~186 served literals are absent), so a route that
 * is served but never declared is invisible to it. That gap is exactly how every
 * bypass in auth.mjs got in: /v1 (3.190.0), the computer plane (3.190.0),
 * /ws/voice (3.191.0), /artifacts/file (3.192.0), /channel + /approvals
 * (3.193.0), and /ledger + /usage/* + diagnostics (3.195.0) were each a route
 * the router served and no list named. A test that walks the declared list can
 * only ever agree with the list.
 *
 * This test walks the router's *served* set instead. It extracts every
 * path-literal the router compares against — `x === "/foo"`, `x !== "/foo"`, and
 * `x.startsWith("/foo")` — from index.mjs and every routes/*.mjs sub-router, and
 * requires each to be protected on a default token gateway EXCEPT the paths in
 * OPEN below, each with the reason it is safe to serve without the operator
 * token. A new served route that isn't protected, and isn't justified in OPEN,
 * fails here with its own path — before it ships, not 100 releases later.
 *
 * The extraction is deliberately over-approximate: it captures every `/…`
 * comparison literal regardless of the variable name, including a handful that
 * are matched after a prefix is stripped (`rest === "/stats"` inside
 * /swarm/goals). Over-approximation is the safe direction — it checks more
 * strings, never fewer — so a real served path can never slip past by being
 * missed. The few post-strip fragments are OPEN-listed with that reason. The
 * durable fix is a declarative route registry the router dispatches from and
 * this test reads; until then, source extraction is the faithful oracle.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createGatewayAuth } from "../src/gateway/auth.mjs";

const TOKEN = "tok-inventory";

/** Extract the router's served path-literals from source. */
function servedPaths() {
  const gwDir = fileURLToPath(new URL("../src/gateway/", import.meta.url));
  const routesDir = `${gwDir}routes/`;
  const files = [
    `${gwDir}index.mjs`,
    ...readdirSync(routesDir).filter((f) => f.endsWith(".mjs")).map((f) => `${routesDir}${f}`),
  ];
  // Any `=== "/x"`, `!== "/x"`, or `.startsWith("/x")`, any left-hand variable,
  // tolerant of the space the codebase writes after the operator. The `!==` arm
  // matters: a route file that dispatches with an early-return guard
  // (`if (p !== "/complete") return false;` — completion.mjs, objectives.mjs)
  // names its served path only through `!==`. Without this arm those literals
  // never entered the served set, so `/complete` — a POST that spends provider
  // tokens on every call — was protected in auth.mjs but pinned by no test; a
  // refactor dropping its gate arm would have shipped an unauthenticated,
  // token-spending route green. Over-approximation stays the safe direction.
  const re = /(?:===|!==|\.startsWith\()\s*"(\/[^"]*)"/g;
  const served = new Set();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    let m;
    while ((m = re.exec(src))) served.add(m[1]);
  }
  return [...served].sort();
}

/**
 * Served paths a default token gateway answers without the operator token, each
 * with the reason it is safe. This is the audit surface: short, and every line
 * has to stay true. Anything not here MUST be protected in auth.mjs.
 */
const OPEN = {
  "/": "webchat UI page (matchUiRoute); public unless gateway.publicUi:false (own test)",
  "/health": "liveness probe, no data",
  "/ready": "readiness probe, no data",
  "/readiness": "readiness probe, no data",
  "/version": "build string, public",
  "/metrics": "Prometheus scrape; token-gated only when gateway.protectMetrics",
  "/gateway": "endpoint index/landing — route names only, no data",
  "/gateway/health": "health probe, no data",
  // /gateway/info + /info return the same sanitized status payload (config only:
  // host/port/provider/model/ops — no user data, spend or secrets). They stay
  // open because the supervisor polls /gateway/info every 15s as its liveness
  // signal and reads ANY non-2xx as unhealthy → restart
  // (scripts/gateway-supervisor.mjs:141,288, bare fetch, no token); protecting
  // them would drive a restart storm. doctor.mjs reads it too and degrades
  // gracefully. If they ever need gating, the supervisor must send the token first.
  "/gateway/info": "sanitized status; supervisor liveness poll restarts on non-2xx (supervisor.mjs:141,288)",
  "/info": "alias of /gateway/info — identical sanitized status payload",
  "/jwks.json": "public JWKS document — public keys only",
  "/xclaw/jwks.json": "public JWKS document — public keys only",
  "/.well-known/jwks.json": "public JWKS document — public keys only",
  // Self-authenticating in the handler by the state/secret it was issued, never
  // the operator token, so the token-gate must leave them open.
  "/auth/callback": "OAuth AS browser redirect; state-authenticated, not token",
  "/oauth/callback": "OAuth AS browser redirect; state-authenticated, not token",
  "/mcp/oauth/callback": "MCP OAuth AS browser redirect; state-authenticated, not token",
  "/channel/telegram/webhook": "Telegram inbound; handler verifies Telegram's secret header, fails closed",
  "/webhooks/pagerduty": "inbound PagerDuty webhook; HMAC-verified in the handler",
  // Voice subsystem health surface — counters and local model names, no user data.
  "/api/voice/probe": "voice subsystem health probe",
  "/api/voice/metrics": "voice subsystem metrics (counters/model names), no user data",
  // Over-approximation artifact, not a root path: swarm-goals matches
  // `rest === "/stats"` after stripping /swarm/goals, so this literal is a
  // sub-path of a prefix already gated by /swarm. Anon GET /stats → 404.
  "/stats": "post-strip fragment of /swarm/goals/* (not served at root; anon 404); /swarm gates the real path",
};

describe("gateway served inventory: no served route is open by omission", () => {
  const auth = createGatewayAuth({ gateway: { token: TOKEN } });
  const served = servedPaths();

  it("extracted a non-trivial served set (regex canary)", () => {
    assert.ok(served.length >= 150, `served extraction collapsed (${served.length}) — the regex broke`);
  });

  for (const p of served) {
    it(`${p} — ${Object.hasOwn(OPEN, p) ? "open (justified)" : "protected"}`, () => {
      const protectedNow = auth.isProtectedPath(p);
      if (Object.hasOwn(OPEN, p)) {
        assert.equal(
          protectedNow,
          false,
          `${p} is open-listed ("${OPEN[p]}") but the gate now protects it — drop it from OPEN`
        );
      } else {
        assert.equal(
          protectedNow,
          true,
          `${p} is a served route with no operator-token protection and no justified OPEN entry. ` +
            `Protect it in auth.mjs isProtectedPath, or add it to OPEN with the reason it is safe unauthenticated.`
        );
      }
    });
  }

  it("OPEN has no dead entries (every open-listed path is actually served)", () => {
    const servedSet = new Set(served);
    for (const p of Object.keys(OPEN)) {
      assert.ok(servedSet.has(p), `OPEN lists ${p} but the router no longer serves that literal — remove it`);
    }
  });
});
