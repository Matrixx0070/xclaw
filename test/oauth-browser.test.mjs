import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pkcePair, randomState, base64url } from "../src/auth/pkce.mjs";
import { listConnectedOAuthProviders, getConnectedOAuthProvider } from "../src/connected/oauth-providers.mjs";
import crypto from "node:crypto";

describe("OAuth browser PKCE", () => {
  it("pkcePair produces s256-shaped challenge", () => {
    const { verifier, challenge } = pkcePair();
    assert.ok(verifier.length >= 40);
    assert.ok(challenge.length >= 40);
    const expected = base64url(crypto.createHash("sha256").update(verifier).digest());
    assert.equal(challenge, expected);
  });

  it("randomState is unique-ish", () => {
    const a = randomState();
    const b = randomState();
    assert.notEqual(a, b);
  });

  it("lists github and google providers", () => {
    const list = listConnectedOAuthProviders();
    assert.ok(list.find((p) => p.id === "github"));
    assert.ok(list.find((p) => p.id === "google"));
    assert.equal(getConnectedOAuthProvider("github").tokenUrl.includes("github"), true);
  });
});
