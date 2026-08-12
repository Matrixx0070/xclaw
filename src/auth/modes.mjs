/**
 * Three ways XClaw uses Grok models (product contract):
 *
 *  1) api      — Grok API key (console.x.ai → XAI_API_KEY)
 *  2) oauth    — Grok OAuth / CLI login (~/.grok/auth.json or device/PKCE)
 *  3) web      — Grok web login (browser session from grok.com / accounts.x.ai)
 *
 * All three are first-class modes. Web uses a user-provided session after
 * browser login (cookie / token file), not silent credential theft.
 */
export const GROK_AUTH_MODES = {
  api: {
    id: "api",
    name: "Grok API",
    description: "API key from https://console.x.ai",
    env: ["XAI_API_KEY", "XCLAW_API_KEY"],
  },
  oauth: {
    id: "oauth",
    name: "Grok OAuth / CLI",
    description: "grok login, device code, or PKCE → tokens in ~/.xclaw/auth.json",
  },
  web: {
    id: "web",
    name: "Grok Web login",
    description:
      "Sign in at grok.com / accounts.x.ai in a browser, then import session into XClaw",
  },
};

export function listGrokAuthModes() {
  return Object.values(GROK_AUTH_MODES);
}
