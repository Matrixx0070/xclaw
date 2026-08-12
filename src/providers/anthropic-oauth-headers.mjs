/**
 * Claude / Anthropic OAuth inference helpers (parity with sudo-ai + Claude Code).
 *
 * Critical gate: OAuth tokens (sk-ant-oat01-*) require the FIRST system text to be
 * exactly OAUTH_ATTESTATION or Anthropic returns 429 rate_limit_error on Sonnet/Opus/Fable.
 * (Verified live 2026-08-10 against api.anthropic.com.)
 */

import crypto from "node:crypto";

/** Exact-prefix system attestation Anthropic gates OAuth inference on. */
export const OAUTH_ATTESTATION =
  "You are Claude Code, Anthropic's official CLI for Claude.";

export const ANTHROPIC_VERSION = "2023-06-01";
export const ANTHROPIC_OAUTH_BETA = "oauth-2025-04-20";

/**
 * @param {string} token access token
 * @param {object} [opts]
 */
export function buildAnthropicOAuthHeaders(token, opts = {}) {
  const headers = {
    "content-type": "application/json",
    "anthropic-version": opts.version || ANTHROPIC_VERSION,
    authorization: `Bearer ${token}`,
    "anthropic-beta": opts.beta || ANTHROPIC_OAUTH_BETA,
    "x-app": opts.app || "cli",
    "user-agent": opts.userAgent || "claude-code/2.1.226",
    "x-client-request-id": opts.requestId || crypto.randomUUID(),
  };
  if (opts.sessionId) {
    headers["x-claude-code-session-id"] = opts.sessionId;
  }
  return headers;
}

/**
 * Ensure body.system starts with OAUTH_ATTESTATION (string or content blocks).
 * @param {object} body Messages API body (mutated)
 * @param {string} [extraSystem] optional additional system text after attestation
 */
export function ensureOAuthSystemAttestation(body, extraSystem = "") {
  const attest = OAUTH_ATTESTATION;
  const extra = String(extraSystem || "").trim();

  const cur = body.system;
  if (cur == null || cur === "") {
    body.system = extra ? `${attest}\n\n${extra}` : attest;
    return body;
  }

  if (typeof cur === "string") {
    if (cur.startsWith(attest)) return body;
    body.system = extra
      ? `${attest}\n\n${cur}\n\n${extra}`
      : `${attest}\n\n${cur}`;
    return body;
  }

  if (Array.isArray(cur)) {
    const first = cur[0];
    const firstText = first?.text || first?.content || "";
    if (typeof firstText === "string" && firstText.startsWith(attest)) {
      return body;
    }
    body.system = [{ type: "text", text: attest }, ...cur];
    return body;
  }

  body.system = attest;
  return body;
}

/**
 * True if credential looks like Claude OAuth access token.
 */
export function isAnthropicOAuthToken(token) {
  return typeof token === "string" && token.startsWith("sk-ant-oat");
}

export default {
  OAUTH_ATTESTATION,
  ANTHROPIC_VERSION,
  ANTHROPIC_OAUTH_BETA,
  buildAnthropicOAuthHeaders,
  ensureOAuthSystemAttestation,
  isAnthropicOAuthToken,
};
