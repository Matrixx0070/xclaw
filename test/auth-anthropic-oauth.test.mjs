import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAnthropicAuthorizeUrl,
  parsePastedAuthCode,
  pkcePair,
  CLAUDE_CODE_CLIENT_ID,
} from "../src/auth/anthropic-oauth.mjs";
import { canStartOAuth } from "../src/auth/oauth-policy.mjs";

describe("Anthropic/Claude OAuth PKCE", () => {
  it("canStartOAuth allows anthropic", () => {
    const g = canStartOAuth("anthropic");
    assert.equal(g.ok, true);
    assert.equal(g.policy.oauth.kind, "claude_pkce");
  });

  it("buildAuthorizeUrl has PKCE params matching Claude Code shape", () => {
    const built = buildAnthropicAuthorizeUrl({ mode: "max" });
    assert.ok(built.url.includes("claude.ai/oauth/authorize"));
    assert.ok(built.url.includes("client_id=" + CLAUDE_CODE_CLIENT_ID));
    assert.ok(built.url.includes("code_challenge="));
    assert.ok(built.url.includes("code_challenge_method=S256"));
    assert.ok(built.url.includes("response_type=code"));
    assert.ok(built.verifier.length > 20);
    assert.ok(built.state);
  });

  it("parsePastedAuthCode handles CODE#STATE", () => {
    assert.deepEqual(parsePastedAuthCode("abc123#st456"), {
      code: "abc123",
      state: "st456",
    });
    assert.equal(parsePastedAuthCode("onlycode").code, "onlycode");
  });

  it("pkcePair is unique", () => {
    const a = pkcePair();
    const b = pkcePair();
    assert.notEqual(a.verifier, b.verifier);
  });
});
