/**
 * PKCE helpers (S256) for OAuth browser login.
 */
import crypto from "node:crypto";

export function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function pkcePair() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(bytes = 16) {
  return base64url(crypto.randomBytes(bytes));
}
