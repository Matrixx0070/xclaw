import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseSetCookieLine,
  parseCookieInput,
  toCookieHeader,
  toBrowserCookieParams,
  enforceSecureForXaiHosts,
} from "../src/auth/cookie-flags.mjs";

describe("HttpOnly cookie flags", () => {
  it("parses Set-Cookie with HttpOnly Secure SameSite", () => {
    const c = parseSetCookieLine(
      "session=abc; Path=/; Domain=.x.ai; Secure; HttpOnly; SameSite=Lax"
    );
    assert.equal(c.name, "session");
    assert.equal(c.value, "abc");
    assert.equal(c.httpOnly, true);
    assert.equal(c.secure, true);
    assert.equal(c.sameSite, "lax");
    assert.equal(c.path, "/");
    assert.equal(c.domain, ".x.ai");
  });

  it("SameSite=None forces Secure", () => {
    const c = parseSetCookieLine("a=1; SameSite=None");
    assert.equal(c.sameSite, "none");
    assert.equal(c.secure, true);
  });

  it("request header has no flags but toBrowserCookieParams can set HttpOnly", () => {
    const list = parseCookieInput("a=1; b=2");
    assert.equal(list.length, 2);
    assert.equal(toCookieHeader(list), "a=1; b=2");
    const p = toBrowserCookieParams(
      { ...list[0], httpOnly: true, secure: true },
      { url: "https://grok.com" }
    );
    assert.equal(p.httpOnly, true);
    assert.equal(p.secure, true);
  });

  it("enforceSecureForXaiHosts", () => {
    const c = enforceSecureForXaiHosts({
      name: "s",
      value: "1",
      domain: ".grok.com",
      secure: false,
    });
    assert.equal(c.secure, true);
  });
});
