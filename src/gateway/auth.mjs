/**
 * Gateway operator auth (P4.1).
 * Token via cfg.gateway.token | XCLAW_GATEWAY_TOKEN
 * Headers: Authorization: Bearer <token>  or  x-xclaw-token / x-api-key
 */
export function createGatewayAuth(cfg = {}) {
  const token =
    cfg.gateway?.token ||
    cfg.gateway?.authToken ||
    process.env.XCLAW_GATEWAY_TOKEN ||
    null;
  const required = Boolean(token);
  const protectMetrics = cfg.gateway?.protectMetrics === true;
  /** When true, all non-open paths require token if token is set */
  const strict = cfg.gateway?.authStrict !== false;

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
  ]);

  function isProtectedPath(p) {
    if (alwaysOpen.has(p)) return false;
    // static UI can stay open unless strictPublicUi is false
    if (cfg.gateway?.publicUi === false) {
      if (
        p.startsWith("/control") ||
        p.startsWith("/chat/") ||
        p.startsWith("/ui/") ||
        p.startsWith("/artifacts")
      ) {
        return required;
      }
    } else {
      if (
        p.startsWith("/control/") ||
        p === "/control" ||
        p.startsWith("/chat/") ||
        p.startsWith("/ui/") ||
        p === "/artifacts" ||
        p === "/artifacts/"
      ) {
        return false;
      }
    }
    if (p === "/metrics") return protectMetrics && (required || requireAuth);
    if (p.startsWith("/webhooks/")) return false; // signed webhooks later
    // requireAuth (prod) protects API even when token is not yet configured
    if (!required && !requireAuth) return false;
    if (!strict) {
      // legacy subset
      return (
        p.startsWith("/security/") ||
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
        p === "/xclaw/jwks/invalidate" ||
        p === "/xclaw/jwks/cache" ||
        p === "/xclaw/jwks/epoch" ||
        p.startsWith("/swarm") ||
        p.startsWith("/subagents")
      );
    }
    // strict: protect API surface
    return (
      p.startsWith("/security/") ||
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
      p.startsWith("/channel/") ||
      p.startsWith("/artifacts/list") ||
      p.startsWith("/doctor") ||
      p.startsWith("/seats") ||
      p.startsWith("/models") ||
      // JWKS operator endpoints (document itself is alwaysOpen)
      p === "/xclaw/jwks/invalidate" ||
      p === "/xclaw/jwks/cache" ||
      p === "/xclaw/jwks/epoch" ||
      p.startsWith("/swarm") ||
      p.startsWith("/subagents")
    );
  }

  function check(req) {
    const p = (req.url || "/").split("?")[0];
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
    if (got && got === token) return { ok: true, mode: "token" };
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
    if (got && got === token) {
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
    strict,
  };
}
