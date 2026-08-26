import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { tryHandleProvidersRoute } from "../src/gateway/routes/providers.mjs";

// Web OAuth flow for providers (3.94.2): the Providers panel could store API
// keys but OAuth was CLI-only. oauth/start returns an authorize URL + state
// for paste-code PKCE providers (anthropic) and holds the verifier gateway-
// side; oauth/complete exchanges the pasted code and stores the profile.

function call(p, body, cfg) {
  let out = null;
  let status = null;
  return tryHandleProvidersRoute({
    p,
    method: "POST",
    req: { headers: {} },
    res: {},
    url: new URL(`http://local${p}`),
    cfg,
    json: (_res, code, payload) => {
      status = code;
      out = payload;
    },
    readBody: async () => body,
  }).then((handled) => ({ handled, status, out }));
}

describe("providers web OAuth", () => {
  let cfg;
  let dir;
  let origFetch;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-oauth-web-"));
    cfg = { paths: { configDir: dir }, agent: { id: "main" } };
    origFetch = global.fetch;
  });
  after(async () => {
    global.fetch = origFetch;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("start(anthropic) returns authorize URL + state, never the verifier", async () => {
    const { handled, status, out } = await call(
      "/providers/manage/oauth/start",
      { provider: "anthropic" },
      cfg
    );
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal(out.ok, true);
    assert.equal(out.flow, "paste-code");
    assert.match(out.authorizeUrl, /^https:\/\//);
    assert.match(out.authorizeUrl, /code_challenge=/);
    assert.ok(out.state && out.state.length >= 16);
    const flat = JSON.stringify(out);
    assert.equal(flat.includes("verifier"), false, "PKCE verifier must never leave the gateway");
  });

  it("start(xai) falls back to the CLI command", async () => {
    const { status, out } = await call(
      "/providers/manage/oauth/start",
      { provider: "xai" },
      cfg
    );
    assert.equal(status, 200);
    assert.equal(out.ok, false);
    assert.equal(out.flow, "cli");
    assert.match(out.command, /xclaw providers oauth --provider xai/);
  });

  it("complete with unknown state is rejected", async () => {
    const { status, out } = await call(
      "/providers/manage/oauth/complete",
      { state: "nope", code: "abc" },
      cfg
    );
    assert.equal(status, 400);
    assert.match(out.error, /not found or expired/);
  });

  it("full flow: start → complete exchanges the code and stores the profile (mocked token endpoint)", async () => {
    const started = await call(
      "/providers/manage/oauth/start",
      { provider: "anthropic", name: "webtest" },
      cfg
    );
    assert.equal(started.out.ok, true);
    const state = started.out.state;

    let tokenReq = null;
    global.fetch = async (url, opts) => {
      tokenReq = { url: String(url), body: JSON.parse(opts.body) };
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            access_token: "sk-ant-oat01-WEBTEST",
            refresh_token: "refresh-WEBTEST",
            expires_in: 3600,
            scope: "user:inference",
          }),
      };
    };
    const done = await call(
      "/providers/manage/oauth/complete",
      { state, code: "AUTHCODE#" + state },
      cfg
    );
    global.fetch = origFetch;

    assert.equal(done.status, 200, JSON.stringify(done.out));
    assert.equal(done.out.ok, true);
    assert.equal(done.out.profileId, "anthropic:webtest");
    assert.ok(tokenReq, "token endpoint was called");
    assert.equal(tokenReq.body.code, "AUTHCODE");
    assert.ok(tokenReq.body.code_verifier, "verifier sent to the token endpoint");
    const flat = JSON.stringify(done.out);
    assert.equal(flat.includes("sk-ant-oat01-WEBTEST"), false, "tokens never echoed");
    assert.equal(flat.includes("refresh-WEBTEST"), false);

    // Stored profile is resolvable
    const { resolveProviderToken } = await import("../src/auth/profiles.mjs");
    const r = await resolveProviderToken(
      { paths: cfg.paths, agent: { id: "main" } },
      "anthropic",
      { profileId: "anthropic:webtest" }
    );
    assert.equal(r.token, "sk-ant-oat01-WEBTEST");

    // state is single-use
    const again = await call(
      "/providers/manage/oauth/complete",
      { state, code: "AUTHCODE" },
      cfg
    );
    assert.equal(again.status, 400);
  });

  it("REJECTS an expired pending flow — a stale state never reaches the exchange", async () => {
    // The complete handler's expiry arm (Date.now() - pending.at > OAUTH_TTL_MS,
    // providers.mjs:295) is the SOLE consume-time guard on a stale PKCE verifier +
    // state: sweepOauthPending() runs only on /oauth/start (:261), so a user who
    // starts a flow, waits past the 10-min TTL, then pastes the code with no
    // intervening start is gated ONLY here. The prior tests hit this line's other
    // arm (!pending, via an unknown state or a consumed one) or a fresh pending
    // (age ~0), so none ever drove the expiry arm true. Mutating it to always-false
    // left the whole suite green (blind spot, mutation-sweep #54).
    const realNow = Date.now;
    const T0 = realNow.call(Date);
    let started;
    try {
      Date.now = () => T0; // freeze so pending.at === T0
      started = await call(
        "/providers/manage/oauth/start",
        { provider: "anthropic", name: "expiretest" },
        cfg
      );
    } finally {
      Date.now = realNow;
    }
    assert.equal(started.out.ok, true);
    const state = started.out.state;

    // Advance past the TTL, then complete. A VALID token endpoint is mocked, so if
    // the expiry arm were dropped the stale flow would succeed (200) and reach the
    // exchange; the test asserts it is rejected (400) before fetch is ever called.
    let fetchCalled = false;
    const savedFetch = global.fetch;
    global.fetch = async () => {
      fetchCalled = true;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            access_token: "sk-ant-oat01-STALE",
            refresh_token: "r-STALE",
            expires_in: 3600,
          }),
      };
    };
    let done;
    try {
      Date.now = () => T0 + 11 * 60_000; // 11 min > 10 min TTL
      done = await call(
        "/providers/manage/oauth/complete",
        { state, code: "AUTHCODE" },
        cfg
      );
    } finally {
      Date.now = realNow;
      global.fetch = savedFetch;
    }
    assert.equal(done.status, 400, "an expired pending flow must be rejected");
    assert.match(done.out.error, /not found or expired/);
    assert.equal(fetchCalled, false, "a stale flow must never reach the token exchange");
  });
});
