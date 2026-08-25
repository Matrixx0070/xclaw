/**
 * The gateway's static UI route table — ONE definition, shared by the code that
 * serves the pages and the gate that protects them.
 *
 * It exists because those were two hand-maintained lists and they drifted.
 * index.mjs serves the webchat page at "/", "/chat", "/chat/" and "/chat/*";
 * auth.mjs's publicUi:false lockdown listed "/chat/" only. So on a gateway with
 * a token configured and the UI explicitly locked down, GET /chat/ answered 401
 * while GET /chat answered 200 with the same HTML — proven on a real socket
 * against a real gateway before this module existed (3.191.0 and every release
 * back to the switch's introduction).
 *
 * Same failure shape as the /v1 alias (3.190.0) and /ws/voice (3.191.0): two
 * derivations of one decision. The rule this file encodes is that a page is
 * reachable at exactly the paths this matcher returns non-null for, and the
 * gate is asked about the same set.
 *
 * @typedef {{ app: "control" | "webchat" | "artifacts", rel: string }} UiRoute
 */

/**
 * Webchat's on/off switch, read the one way. index.mjs and auth.mjs both need
 * it and a third copy of `!== false` is a third chance to drift.
 * @param {any} cfg
 */
export function isWebchatEnabled(cfg) {
  return cfg?.channels?.webchat?.enabled !== false;
}

/**
 * Which static UI page (if any) a pathname addresses.
 *
 * `rel` is the file under that app's root, already de-dotted by the caller's
 * path.normalize — this function decides routing, not filesystem safety.
 *
 * @param {string} p pathname, /v1-stripped
 * @param {{ webchatEnabled?: boolean }} [opts]
 * @returns {UiRoute | null}
 */
export function matchUiRoute(p, { webchatEnabled = true } = {}) {
  if (p === "/control" || p === "/control/") return { app: "control", rel: "index.html" };
  if (p.startsWith("/control/")) {
    return { app: "control", rel: p.slice("/control/".length) || "index.html" };
  }
  // The artifacts browser page — NOT /artifacts/list or /artifacts/file, which
  // return operator data and are API, gated with the rest of the API. A
  // startsWith("/artifacts") here is what let /artifacts/list read the
  // workspace unauthenticated whenever publicUi was false.
  if (p === "/artifacts" || p === "/artifacts/") return { app: "artifacts", rel: "index.html" };
  if (!webchatEnabled) return null;
  if (p === "/" || p === "/chat" || p === "/chat/") return { app: "webchat", rel: "index.html" };
  if (p.startsWith("/chat/")) {
    return { app: "webchat", rel: p.slice("/chat/".length) || "index.html" };
  }
  return null;
}

export default { matchUiRoute, isWebchatEnabled };
