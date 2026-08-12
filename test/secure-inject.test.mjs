import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSecureInjectPlan,
  injectCookiesSecure,
  isHostAllowed,
} from "../src/auth/secure-inject.mjs";

describe("secure cookie injection", () => {
  it("allowlists hosts", () => {
    assert.equal(isHostAllowed("grok.com"), true);
    assert.equal(isHostAllowed("evil.com"), false);
  });

  it("rejects http urls", () => {
    assert.throws(() =>
      buildSecureInjectPlan({
        cookieHeader: "a=1",
        url: "http://grok.com",
      })
    );
  });

  it("rejects non-allowlisted host", () => {
    assert.throws(() =>
      buildSecureInjectPlan({
        cookieHeader: "a=1",
        url: "https://evil.example",
      })
    );
  });

  it("forces HttpOnly and Secure on plan", () => {
    const plan = buildSecureInjectPlan({
      cookieHeader: "session=secretvalue; Path=/",
      url: "https://grok.com",
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.params[0].httpOnly, true);
    assert.equal(plan.params[0].secure, true);
    assert.ok(!JSON.stringify(plan.flags).includes("secretvalue"));
  });

  it("rejects cookie domain outside allowlist", () => {
    const plan = buildSecureInjectPlan({
      cookieHeader: "x=1; Domain=.evil.com; Path=/",
      url: "https://grok.com",
    });
    assert.equal(plan.rejected.length >= 1, true);
  });

  it("injects via mock CDP with httpOnly", async () => {
    const calls = [];
    const cdp = {
      send: async (method, params) => {
        calls.push({ method, params });
      },
    };
    const plan = buildSecureInjectPlan({
      cookieHeader: "session=abc",
      url: "https://accounts.x.ai/",
    });
    const r = await injectCookiesSecure(cdp, plan);
    assert.equal(r.ok, true);
    assert.equal(r.via, "cdp");
    const set = calls.find((c) => c.method === "Network.setCookie");
    assert.equal(set.params.httpOnly, true);
    assert.equal(set.params.secure, true);
  });

  it("injects via mock Playwright context", async () => {
    let added = null;
    const ctx = {
      clearCookies: async () => {},
      addCookies: async (list) => {
        added = list;
      },
    };
    const plan = buildSecureInjectPlan({
      cookieHeader: "a=1; b=2",
      url: "https://grok.com",
    });
    const r = await injectCookiesSecure(ctx, plan);
    assert.equal(r.ok, true);
    assert.equal(added.length, 2);
    assert.equal(added[0].httpOnly, true);
    assert.equal(added[0].secure, true);
  });
});
