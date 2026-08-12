/**
 * Connected OAuth / API app catalog (P3.1).
 */
import { getAppToken } from "./token-store.mjs";

export const CONNECTED_CATALOG = [
  {
    id: "voice",
    name: "Voice TTS",
    description: "Text-to-speech (local espeak or OpenAI-compatible TTS API)",
    envKeys: ["OPENAI_API_KEY", "XAI_API_KEY", "TTS_API_KEY", "TTS_BASE_URL"],
    tools: [
      {
        name: "voice_speak",
        description: "Speak text to an audio file",
        input_schema: {
          type: "object",
          properties: {
            text: { type: "string" },
            out: { type: "string" },
            voice: { type: "string" },
          },
          required: ["text"],
        },
      },
    ],
  },
  {
    id: "github",
    name: "GitHub",
    description: "GitHub REST API via GITHUB_TOKEN or stored token",
    envKeys: ["GITHUB_TOKEN", "GH_TOKEN"],
    tools: [
      {
        name: "github_request",
        description: "Call GitHub API path e.g. /user or /repos/o/r/issues",
        input_schema: {
          type: "object",
          properties: {
            method: { type: "string" },
            path: { type: "string" },
            body: { type: "object" },
          },
          required: ["path"],
        },
      },
    ],
  },
  {
    id: "generic_http",
    name: "Generic HTTP",
    description: "HTTP using stored connected token",
    envKeys: [],
    tools: [
      {
        name: "connected_http",
        description: "HTTP request with Bearer from connected app store",
        input_schema: {
          type: "object",
          properties: {
            app_id: { type: "string" },
            method: { type: "string" },
            url: { type: "string" },
            body: { type: "object" },
          },
          required: ["app_id", "url"],
        },
      },
    ],
  },
];

export function listCatalogTools() {
  const out = [];
  for (const app of CONNECTED_CATALOG) {
    for (const t of app.tools) {
      out.push({
        ...t,
        app_id: app.id,
        app_name: app.name,
        description: `[${app.name}] ${t.description}`,
      });
    }
  }
  return out;
}

export async function resolveToken(cfg, appId, opts = {}) {
  const userId = opts.userId || null;
  let uid = userId;
  if (!uid) {
    try {
      const { getRequestUserId } = await import("./request-context.mjs");
      uid = getRequestUserId();
    } catch {
      /* */
    }
  }
  // P6/P7: multi-user vault first when we have a channel userId
  if (uid && uid !== "default") {
    try {
      const { vaultResolveToken } = await import("./vault.mjs");
      const v = await vaultResolveToken(cfg, appId, uid);
      if (v?.accessToken) {
        return {
          accessToken: v.accessToken,
          source: v.source || "vault",
          userId: uid,
          expiresAt: v.expiresAt,
        };
      }
    } catch {
      /* fall through */
    }
  }
  const { ensureFreshToken } = await import("./token-refresh.mjs");
  const fresh = await ensureFreshToken(cfg, appId, opts);
  if (fresh.ok && fresh.accessToken) {
    return {
      accessToken: fresh.accessToken,
      source: fresh.source,
      refreshed: fresh.refreshed,
      expiresAt: fresh.expiresAt,
      rotated: fresh.rotated,
      userId: uid || "default",
    };
  }
  // last resort: raw store without refresh (e.g. static PAT in store)
  const stored = await getAppToken(cfg, appId);
  if (stored?.accessToken || stored?.token) {
    return {
      accessToken: stored.accessToken || stored.token,
      source: "store",
      stale: true,
      error: fresh.error,
      userId: uid || "default",
    };
  }
  return null;
}
