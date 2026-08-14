import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGatewayAuth } from "../src/gateway/auth.mjs";

// Review finding (3.95.1): /cost, /cost/pause, /usage, /logs were added only
// to the STRICT protection list — a non-strict deployment with a token set
// left POST /cost/pause (state-changing: pauses ALL spend) and the
// session-preview-exposing usage/logs reads unauthenticated. Both branches
// must protect them.

const PATHS = [
  "/cost", "/cost/pause", "/usage", "/logs", "/logs/run?id=x",
  // pairing is state-changing (approve grants a sender DM access) — a
  // review flagged it; both auth branches had it all along, pinned here.
  "/pairing/pending", "/pairing/approve", "/pairing/revoke",
  // 2026-08-13 sweep: these families were in NEITHER branch — unauthenticated
  // callers could fire real pages (/alerts/pd), spend money (/media/jobs,
  // /checkpoints/resume, /eval), install skills, start the computer runtime,
  // and read transcripts/memory/spend detail. Pinned in BOTH modes.
  "/alerts/status", "/alerts/test", "/alerts/pd",
  "/webhooks/pagerduty/recent",
  "/media/providers", "/media/jobs",
  "/memory", "/transcripts", "/transcripts/abc",
  "/checkpoints", "/checkpoints/resume",
  "/skills", "/skills/proposals", "/skills/proposals/decide", "/skills/stats",
  "/eval/baseline", "/eval/history",
  "/tokens/cost", "/profile",
  "/computer/start", "/computer/stop", "/computer/health",
  "/events/eviction", "/events/eviction/stream",
  "/doctor", "/doctor/run",
  // hook management adds SHELL EXECUTION config — must be token-gated
  "/hooks", "/hooks/history", "/hooks/toggle", "/hooks/commands",
  // missions run autonomous agents against repos
  "/missions", "/missions/abc", "/missions/abc/merge", "/missions/abc/rollback",
];

describe("cost/usage/logs auth coverage", () => {
  for (const strict of [true, false]) {
    it(`token required in ${strict ? "strict" : "legacy"} mode`, () => {
      const a = createGatewayAuth({ gateway: { token: "t", authStrict: strict } });
      for (const p of PATHS) {
        assert.equal(
          a.check({ url: p, headers: {} }).ok,
          false,
          `${p} must require a token (strict=${strict})`
        );
        assert.equal(
          a.check({ url: p, headers: { authorization: "Bearer t" } }).ok,
          true,
          `${p} must accept the token (strict=${strict})`
        );
      }
      // Inbound HMAC-verified webhooks must STAY reachable without an
      // operator token — only the /recent read above is gated.
      assert.equal(
        a.check({ url: "/webhooks/pagerduty", headers: {} }).ok,
        true,
        `/webhooks/pagerduty must stay open for signed deliveries (strict=${strict})`
      );
      // MCP OAuth: the AS browser redirect can't carry the operator token —
      // callback stays open (state-authenticated); start/complete stay gated.
      assert.equal(
        a.check({ url: "/mcp/oauth/callback?code=x&state=y", headers: {} }).ok,
        true,
        `/mcp/oauth/callback must stay open for AS redirects (strict=${strict})`
      );
      for (const g of ["/mcp/oauth/start", "/mcp/oauth/complete", "/mcp/oauth/status"]) {
        assert.equal(
          a.check({ url: g, headers: {} }).ok,
          false,
          `${g} must require a token (strict=${strict})`
        );
      }
    });
  }
});
