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

// RULE(a) boundary — the cookie-injection host allowlist matcher
//   (secure-inject.mjs:37) is  h === x || h.endsWith("." + x)
// The `"." +` is the subdomain-boundary guard: a host whose NAME merely shares an
// allowlisted domain's trailing string ("grok.com" vs "evilgrok.com", "x.ai" vs
// "notx.ai") is NOT a subdomain of it and must be REFUSED — otherwise Grok/xAI
// SESSION COOKIES get injected into an attacker-registered lookalike host (via the
// page-URL gate at :68 and the per-cookie domain gate at :96). Every pre-existing
// test hit either the exact-match arm ("grok.com" === "grok.com") or a fully
// disjoint reject ("evil.com" / "evil.example" / ".evil.com"), so NONE exercised
// the suffix boundary: dropping `"." +` (endsWith(x)) left the FULL suite green
// (3654/0), silently widening injection to any shared-suffix sibling of an
// allowlisted domain. These pin the sibling REJECT (mutated → RED) with a
// real-subdomain ADMIT (green both ways) — the same hostname suffix-boundary
// discipline the email-sender (allow-from.mjs) and egress (egress.mjs) gates
// already carry, re-proven here because coverage does NOT transfer across the
// distinct call sites of an identical matcher shape.
describe("secure-inject host allowlist suffix boundary", () => {
  it("REFUSES a lookalike host that only shares an allowlisted domain's suffix", () => {
    // "evilgrok.com" ends with the STRING "grok.com" but is not under ".grok.com"
    assert.equal(isHostAllowed("evilgrok.com"), false);
    // and the x.ai family: "notx.ai" ends with "x.ai" but is not under ".x.ai"
    assert.equal(isHostAllowed("notx.ai"), false);
  });

  it("admits a real subdomain of an allowlisted domain (boundary admit)", () => {
    assert.equal(isHostAllowed("accounts.grok.com"), true);
  });

  it("rejects a lookalike page URL for the full inject plan", () => {
    assert.throws(
      () =>
        buildSecureInjectPlan({
          cookieHeader: "a=1",
          url: "https://evilgrok.com",
        }),
      /not allowlisted/,
      "a shared-suffix lookalike of an allowlisted host must be refused for inject"
    );
  });
});
