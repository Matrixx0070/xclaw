/**
 * Gateway operator auth (P4.1).
 * Token via cfg.gateway.token | XCLAW_GATEWAY_TOKEN
 * Headers: Authorization: Bearer <token>  or  x-xclaw-token / x-api-key
 */
import crypto from "node:crypto";
import { COMPUTER_PROXY_PREFIXES } from "./computer-proxy.mjs";
import { matchUiRoute, isWebchatEnabled } from "./ui-routes.mjs";

/**
 * `/v1/<route>` is an alias for every route. The gateway strips that prefix
 * before routing, so auth has to decide on the SAME string or the alias is an
 * auth bypass — which it was from 3.83.0 (d4f48d6) to 3.190.0: index.mjs
 * stripped and asked isProtectedPath("/hooks") while check() re-derived the
 * path from the raw req.url, saw "/v1/hooks", matched no protection list and
 * returned { ok: true, mode: "open" }. Two derivations of one decision input
 * always drift; this is the one derivation both callers use.
 *
 * Single strip on purpose. The point is that routing and auth agree, not how
 * many prefixes are peeled: "/v1/v1/hooks" normalizes to "/v1/hooks" on both
 * sides, so auth leaves it open and routing 404s it — no route is reachable
 * that auth did not see.
 * @param {string} pathname
 * @returns {{ path: string, versioned: boolean }}
 */
export function stripApiVersion(pathname) {
  const p = String(pathname ?? "/").split("?")[0] || "/";
  if (p === "/v1" || p.startsWith("/v1/")) return { path: p.slice(3) || "/", versioned: true };
  return { path: p, versioned: false };
}

/** Constant-time token compare (sha256 both sides to equalize length). */
function tokenEqual(got, expected) {
  if (!got || !expected) return false;
  const a = crypto.createHash("sha256").update(String(got)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

export function createGatewayAuth(cfg = {}) {
  const token =
    cfg.gateway?.token ||
    cfg.gateway?.authToken ||
    process.env.XCLAW_GATEWAY_TOKEN ||
    null;
  const required = Boolean(token);
  const protectMetrics = cfg.gateway?.protectMetrics === true;

  /** Fail-closed when profile=prod or gateway.requireAuth=true */
  const requireAuth =
    cfg.gateway?.requireAuth === true ||
    cfg.profile === "prod" ||
    process.env.XCLAW_GATEWAY_REQUIRE_AUTH === "1" ||
    process.env.XCLAW_GATEWAY_REQUIRE_AUTH === "true";


  const alwaysOpen = new Set([
    "/",
    "/health",
    "/ready",
    "/readiness",
    "/version",
    "/favicon.ico",
    // Public JWKS for JWT verifiers (no private material)
    "/xclaw/jwks.json",
    "/.well-known/jwks.json",
    "/jwks.json",
    // MCP OAuth browser redirect — the AS sends the user here with only
    // code+state; authenticated by the one-time state, not the operator token.
    "/mcp/oauth/callback",
  ]);

  const webchatEnabled = isWebchatEnabled(cfg);

  function isProtectedPath(p) {
    // The static UI, decided by the same route table that serves it. Before
    // the table this was a second hand-written list and it disagreed with the
    // router: "/chat" and "/" serve the webchat page, the list matched only
    // "/chat/", so the lockdown below missed the page it was locking down.
    // Ahead of alwaysOpen because "/" IS the webchat page when webchat is on.
    if (matchUiRoute(p, { webchatEnabled })) {
      if (cfg.gateway?.publicUi !== false) return false;
      // Lockdown: the UI joins the protected surface. `required || requireAuth`
      // and not `required` — returning `required` alone short-circuited the
      // requireAuth fail-closed further down, so switching the lockdown ON made
      // a token-less prod gateway MORE open than leaving it off.
      return required || requireAuth;
    }
    if (alwaysOpen.has(p)) return false;
    if (p === "/metrics") return protectMetrics && (required || requireAuth);
    // Inbound webhooks are HMAC-verified in their handlers and must stay
    // reachable without an operator token — EXCEPT the /recent read, which
    // lists received events (operator data, token-gated below).
    if (p.startsWith("/webhooks/") && p !== "/webhooks/pagerduty/recent") return false;
    // Telegram's inbound webhook is the same contract under a different prefix.
    // xclaw registers it itself (setWebhook with secret_token) and the handler
    // verifies that secret, failing closed when none is configured — but the
    // path starts with "/channel/", so the operator-token gate answered 401
    // before the handler ever ran. Telegram sends only its secret header, never
    // a Bearer, so on any gateway with a token configured every inbound update
    // was rejected and the bot went silent. Measured: 401 anonymous with a
    // correct secret header, 503 telegram_disabled with an operator Bearer —
    // the gate, not the handler.
    if (p === "/channel/telegram/webhook") return false;
    // requireAuth (prod) protects API even when token is not yet configured
    if (!required && !requireAuth) return false;
    // State-changing or secret/conversation-exposing surface. Kept as its own
    // block because a 2026-08-13 sweep found every one of these in NEITHER of
    // the two lists that used to follow: unauthenticated callers could fire
    // real alerts (/alerts/pd), spend money (/media/jobs POST,
    // /checkpoints/resume, /eval), install skills, and read transcripts and
    // memory. The two lists are now one; this block stays first because it is
    // the surface where a miss costs money or leaks a transcript.
    const core =
      p.startsWith("/alerts") ||
      p === "/webhooks/pagerduty/recent" ||
      p.startsWith("/media") ||
      p === "/memory" ||
      p.startsWith("/transcripts") ||
      // The artifacts API. /artifacts/list was in the strict list and
      // /artifacts/file — which returns the file BYTES — was in neither, so on
      // a token-protected gateway the listing answered 401 while the download
      // answered 200 with the workspace file, byte-identical to the
      // authenticated response (measured). One prefix, so a third artifacts
      // route cannot land outside the gate the way the second one did. The
      // /artifacts page itself is decided by the UI route table above and never
      // reaches here.
      p.startsWith("/artifacts/") ||
      p.startsWith("/checkpoints") ||
      p.startsWith("/skills") ||
      p.startsWith("/eval") ||
      p.startsWith("/tokens") ||
      p === "/profile" ||
      p.startsWith("/computer/") ||
      // The single-port computer plane. Prefixes come from the proxy module so
      // this list cannot fall behind it; "/computer/" above misses the
      // "/xclaw/computer/" half entirely.
      COMPUTER_PROXY_PREFIXES.some((pref) => p === pref.slice(0, -1) || p.startsWith(pref)) ||
      p.startsWith("/events/") ||
      p.startsWith("/doctor") ||
      // hook management: command hooks EXECUTE arbitrary shell on the host
      p === "/hooks" ||
      p.startsWith("/hooks/") ||
      // missions run autonomous agents against repositories
      p === "/missions" ||
      p.startsWith("/missions/") ||
      // objectives start/steer long-running autonomous missions
      p === "/objectives" ||
      p.startsWith("/objectives/") ||
      // point-and-prompt drives the operator's browser + starts missions
      p === "/point" ||
      p.startsWith("/point/") ||
      // swarm-ext runs autonomous sub-agent fleets and spends provider tokens
      p === "/api/swarm" ||
      p.startsWith("/api/swarm/") ||
      // completions spend provider tokens per call
      p === "/complete";
    if (core) return true;
    // ONE list. There were two — a "legacy" subset for gateway.authStrict:false
    // and a strict superset — and they drifted, which is how every gateway
    // bypass recorded in this file got in. The old legacy block said so itself
    // ("flagged by review: strict-only left legacy deployments open") after
    // /cost, /usage and /logs were moved across; that move missed /channel/.
    // So on an authStrict:false gateway POST /channel/webchat/message — which
    // RUNS THE AGENT — answered without credentials, and /channel/webchat/
    // sessions returned the conversation list byte-identical to the
    // authenticated response, while /agent/run, /artifacts/list and /config all
    // refused correctly (measured on a real socket).
    //
    // After dropping /seats and /models (nothing has ever served either path —
    // 404 with a valid token) and /doctor (already in `core` above), /channel/
    // was the ONLY remaining difference between the two lists: the split's
    // whole surviving effect was leaving agent execution open. Collapsed rather
    // than patched, because one more entry to keep in sync is the defect, not
    // the cure. gateway.authStrict is still accepted and still reported by
    // /dashboard; it no longer decides what the gate protects.
    return (
      p.startsWith("/security/") ||
      // /approvals* is the documented alias for /security/pending + /security/decide
      // (routes-map.mjs: "Alias: pending approvals"). /security/* was gated and the
      // alias was in NEITHER list, so on the DEFAULT gateway an anonymous caller
      // could GET /approvals — leaking a pending's full command, the path AND
      // content of a critical-tier write, measured on the live gateway — and POST
      // /approvals/approve to decide that critical pending: accepted ok:true
      // mode:"human", ledgered as actor:"operator". A separate workspace-containment
      // guard happened to stop that one write, but the last HUMAN gate in front of a
      // risky command had no auth of its own. /agent-runs streamed real session
      // history the same way. Same alias-drift shape as /v1 (3.190.0) and /channel.
      p === "/approvals" ||
      p.startsWith("/approvals/") ||
      p === "/agent-runs" ||
      p.startsWith("/agent-runs/") ||
      p.startsWith("/pairing/") ||
      p.startsWith("/cron/") ||
      p.startsWith("/subagents/") ||
      p.startsWith("/mcp") ||
      p === "/agent" ||
      p.startsWith("/agent/") ||
      p.startsWith("/jobs") ||
      p.startsWith("/queue") ||
      p.startsWith("/sessions") ||
      p.startsWith("/config") ||
      p === "/dashboard" ||
      p === "/report" ||
      // diagnostics + inventory. /doctor is gated in `core`, but /gateway/doctor
      // (the same detailed report) sits under a different prefix and fell
      // through; /status/report is the status markdown; /routes returns every
      // served route as JSON — the full attack surface. /gateway/info + /info
      // stay open by omission on purpose: the supervisor polls /gateway/info
      // every 15s as its liveness signal and reads any non-2xx as
      // unhealthy→restart (gateway-supervisor.mjs:141,288), and the payload is
      // sanitized config only (no user data, spend or secrets).
      p === "/gateway/doctor" ||
      p === "/status/report" ||
      p === "/routes" ||
      // voice synth + transcription run the local audio pipeline (compute);
      // /api/voice/probe and /api/voice/metrics stay open as subsystem health.
      p === "/api/voice/speak" ||
      p === "/api/voice/transcribe" ||
      // Agent execution and conversation history. The inbound Telegram webhook
      // is the one path under this prefix that authenticates itself; it is
      // exempted above, before this list is consulted.
      p.startsWith("/channel/") ||
      // spend-pause + budget state is an operator control
      p === "/cost" ||
      p.startsWith("/cost/") ||
      // the cost/audit ledger: full command+actor+spend history — the same
      // decision events /security/decisions serves, plus every cost row. Named
      // in no list, so on the DEFAULT gateway an anonymous GET /ledger returned
      // the entire 197KB audit history, /ledger/stats the cost rollup and
      // /ledger/who-touched the per-file actor trail (measured on the live
      // gateway). Grouped with /cost because it is the durable record behind it.
      p === "/ledger" ||
      p.startsWith("/ledger/") ||
      // usage analytics + request logs expose session previews/spend. /usage had
      // only the exact arm while its siblings /cost and /logs each gate the
      // prefix too, so /usage/cache, /usage/dashboard and /usage/efficiency —
      // spend and session-preview data — answered anonymously (measured); the
      // missing startsWith("/usage/") is the whole defect.
      p === "/usage" ||
      p.startsWith("/usage/") ||
      p === "/logs" ||
      p.startsWith("/logs/") ||
      // JWKS operator endpoints (document itself is alwaysOpen)
      p === "/xclaw/jwks/invalidate" ||
      p === "/xclaw/jwks/cache" ||
      p === "/xclaw/jwks/epoch" ||
      p.startsWith("/swarm") ||
      p.startsWith("/subagents") ||
      // provider management writes config + stores credentials; a base-url
      // rewrite would aim the stored Bearer token at an attacker host
      p.startsWith("/providers") ||
      // channel management writes config + channel secrets (bot tokens etc.)
      p.startsWith("/channels")
    );
  }

  /**
   * @param {object} req
   * @param {string} [pathOverride] Already normalized by the caller with
   *   stripApiVersion — the gateway passes the exact string it routes on, so
   *   the two can never disagree. Omitted callers get the same normalization
   *   applied here to req.url.
   */
  function check(req, pathOverride) {
    const p = pathOverride ?? stripApiVersion(req.url).path;
    if (!isProtectedPath(p)) return { ok: true, mode: "open" };
    // No token configured: open only in lab/dev unless requireAuth
    if (!token) {
      if (requireAuth) {
        return {
          ok: false,
          mode: "token",
          error: "auth_required_no_token_configured",
          message:
            "Gateway requireAuth is on (prod or gateway.requireAuth) but no token is set. Set XCLAW_GATEWAY_TOKEN.",
        };
      }
      return { ok: true, mode: "open" };
    }
    const hdr = req.headers?.authorization || req.headers?.Authorization || "";
    const bearer = hdr.startsWith("Bearer ") ? hdr.slice(7).trim() : "";
    const x = req.headers?.["x-xclaw-token"] || req.headers?.["x-api-key"];
    const q = (() => {
      try {
        return new URL(req.url || "/", "http://local").searchParams.get("token");
      } catch {
        return null;
      }
    })();
    const got = bearer || x || q || "";
    if (tokenEqual(got, token)) return { ok: true, mode: "token" };
    return { ok: false, mode: "token", error: "unauthorized" };
  }

  /**
   * Authorize a WebSocket upgrade. Browsers can't set Authorization on a WS
   * handshake, so a token may arrive via `?token=`, the `x-xclaw-token` header,
   * or a `Sec-WebSocket-Protocol: xclaw.token.<token>` subprotocol entry.
   * Enforced whenever a token is set OR requireAuth (prod); otherwise open.
   * @returns {{ ok: true, mode: string, protocol?: string } | { ok: false, error: string }}
   */
  function authorizeWebSocket(req) {
    if (!required && !requireAuth) return { ok: true, mode: "open" };
    if (!token) {
      // requireAuth with no token = fail closed
      return { ok: false, error: "auth_required_no_token_configured" };
    }
    const hdr = req.headers?.authorization || req.headers?.Authorization || "";
    const bearer = hdr.startsWith("Bearer ") ? hdr.slice(7).trim() : "";
    const x = req.headers?.["x-xclaw-token"] || req.headers?.["x-api-key"];
    let q = null;
    try {
      q = new URL(req.url || "/", "http://local").searchParams.get("token");
    } catch {
      /* */
    }
    // Subprotocol carrier: "xclaw.token.<token>" (browsers can set this)
    let sub = null;
    let matchedProto = null;
    const protoHdr = req.headers?.["sec-websocket-protocol"];
    if (protoHdr) {
      for (const p of String(protoHdr).split(",").map((s) => s.trim())) {
        if (p.startsWith("xclaw.token.")) {
          sub = p.slice("xclaw.token.".length);
          matchedProto = p;
          break;
        }
      }
    }
    const got = bearer || x || q || sub || "";
    if (tokenEqual(got, token)) {
      return { ok: true, mode: "token", protocol: matchedProto || undefined };
    }
    return { ok: false, error: "unauthorized" };
  }

  return {
    check,
    authorizeWebSocket,
    isProtectedPath,
    required,
    requireAuth,
    protectMetrics,
  };
}
