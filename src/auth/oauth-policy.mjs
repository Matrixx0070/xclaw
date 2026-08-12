/**
 * OAuth policy — Phase 4.
 * Only enable interactive OAuth where a real external client flow exists.
 */
export const AUTH_METHODS = {
  xai: {
    recommended: "api_key",
    supported: ["api_key", "token", "oauth_experimental"],
    oauth: {
      kind: "experimental_oidc",
      requires: ["XCLAW_XAI_OAUTH_CLIENT_ID"],
      note: "xAI public inference API is API-key (Bearer). Browser OAuth only if you have a real client id from xAI/enterprise.",
      consoleKeys: "https://console.x.ai/team/default/api-keys",
    },
  },
  openai: {
    recommended: "api_key",
    supported: ["api_key", "oauth_codex"],
    oauth: {
      kind: "codex_pkce",
      authorize: "https://auth.openai.com/oauth/authorize",
      token: "https://auth.openai.com/oauth/token",
      callbackPort: 1455,
      callbackPath: "/auth/callback",
      scopes: "openid profile email offline_access",
      note: "ChatGPT/Codex subscription OAuth (PKCE). Optional; API key preferred for always-on gateways.",
      requires: [], // public Codex-style client may still need env client id if OpenAI rotates
      envClientId: "XCLAW_OPENAI_OAUTH_CLIENT_ID",
    },
  },
  anthropic: {
    recommended: "api_key",
    supported: ["api_key", "token", "oauth"],
    oauth: {
      kind: "claude_pkce",
      note:
        "Claude/Anthropic OAuth PKCE (Claude Code–compatible client). Prefer ANTHROPIC_API_KEY for pure API billing. Subscription OAuth is experimental.",
      authorize: "https://claude.ai/oauth/authorize",
      token: "https://api.anthropic.com/v1/oauth/token",
      envClientId: "XCLAW_ANTHROPIC_OAUTH_CLIENT_ID",
    },
  },
  openrouter: {
    recommended: "api_key",
    supported: ["api_key"],
    oauth: { kind: "none", note: "API key only." },
  },
  compatible: {
    recommended: "api_key",
    supported: ["api_key"],
    oauth: { kind: "none", note: "API key / local token only." },
  },
};

export function getAuthPolicy(provider = "xai") {
  const p = String(provider || "xai").toLowerCase();
  return (
    AUTH_METHODS[p] || {
      recommended: "api_key",
      supported: ["api_key"],
      oauth: { kind: "none", note: "API key only for this provider." },
    }
  );
}

/**
 * Decide if OAuth login should proceed.
 * @returns {{ ok: boolean, reason?: string, policy: object }}
 */
export function canStartOAuth(provider, env = process.env) {
  const policy = getAuthPolicy(provider);
  const oauth = policy.oauth || { kind: "none" };

  if (oauth.kind === "none") {
    return {
      ok: false,
      reason: oauth.note || `OAuth not supported for ${provider}. Use --method api-key.`,
      policy,
    };
  }

  if (oauth.kind === "experimental_oidc") {
    const clientId = env.XCLAW_XAI_OAUTH_CLIENT_ID || env.XCLAW_OAUTH_CLIENT_ID;
    if (!clientId) {
      return {
        ok: false,
        reason:
          `xAI OAuth requires XCLAW_XAI_OAUTH_CLIENT_ID (enterprise/OIDC). ` +
          `Public API: create a key at ${oauth.consoleKeys || "https://console.x.ai"} ` +
          `then: xclaw models auth login --provider xai --method api-key --api-key xai-...`,
        policy,
      };
    }
    return { ok: true, policy };
  }

  if (oauth.kind === "codex_pkce") {
    // Allow start; loginOpenAICodex will use env client id or documented default if any
    return { ok: true, policy };
  }

  if (oauth.kind === "claude_pkce") {
    return { ok: true, policy };
  }

  return { ok: false, reason: "Unknown OAuth kind", policy };
}

export function authPolicyReport() {
  return Object.entries(AUTH_METHODS).map(([id, p]) => ({
    provider: id,
    recommended: p.recommended,
    supported: p.supported,
    oauth: p.oauth?.kind || "none",
    note: p.oauth?.note || null,
  }));
}
