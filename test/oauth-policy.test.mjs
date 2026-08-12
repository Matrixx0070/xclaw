
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canStartOAuth, getAuthPolicy, authPolicyReport } from "../src/auth/oauth-policy.mjs";

describe("oauth policy", () => {
  it("xai oauth blocked without client id", () => {
    const r = canStartOAuth("xai", {});
    assert.equal(r.ok, false);
    assert.match(r.reason, /API key|console\.x\.ai|XCLAW_XAI_OAUTH_CLIENT_ID/i);
  });
  it("xai oauth allowed with client id", () => {
    const r = canStartOAuth("xai", { XCLAW_XAI_OAUTH_CLIENT_ID: "cid" });
    assert.equal(r.ok, true);
  });
  it("anthropic has no oauth", () => {
    const r = canStartOAuth("anthropic", {});
    assert.equal(r.ok, false);
    assert.equal(getAuthPolicy("anthropic").recommended, "api_key");
  });
  it("openai codex allowed to start", () => {
    const r = canStartOAuth("openai", {});
    assert.equal(r.ok, true);
    assert.equal(getAuthPolicy("openai").oauth.kind, "codex_pkce");
  });
  it("report lists providers", () => {
    const rep = authPolicyReport();
    assert.ok(rep.some((x) => x.provider === "xai"));
  });
});
