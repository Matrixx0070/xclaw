/**
 * Prod bind + token smoke: non-loopback without token is refused.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isLoopbackHost,
  assertBindSafety,
} from "../src/gateway/bind-guard.mjs";

describe("bind safety", () => {
  it("loopback hosts are recognized", () => {
    assert.equal(isLoopbackHost("127.0.0.1"), true);
    assert.equal(isLoopbackHost("localhost"), true);
    assert.equal(isLoopbackHost("::1"), true);
    assert.equal(isLoopbackHost("0.0.0.0"), false);
    assert.equal(isLoopbackHost("192.168.1.10"), false);
  });

  it("loopback may be tokenless", () => {
    const r = assertBindSafety({ gateway: { host: "127.0.0.1" } });
    assert.equal(r.ok, true);
  });

  it("0.0.0.0 without token is refused", () => {
    const prev = process.env.XCLAW_GATEWAY_ALLOW_OPEN;
    delete process.env.XCLAW_GATEWAY_ALLOW_OPEN;
    delete process.env.XCLAW_GATEWAY_TOKEN;
    const r = assertBindSafety({
      profile: "prod",
      gateway: { host: "0.0.0.0" },
    });
    if (prev === undefined) delete process.env.XCLAW_GATEWAY_ALLOW_OPEN;
    else process.env.XCLAW_GATEWAY_ALLOW_OPEN = prev;
    assert.equal(r.ok, false);
    assert.match(r.error, /without auth|TOKEN/i);
  });

  it("0.0.0.0 with gateway.token is allowed", () => {
    const r = assertBindSafety({
      profile: "prod",
      gateway: { host: "0.0.0.0", token: "test-token-32chars-minimum-ok" },
    });
    assert.equal(r.ok, true);
  });

  it("ALLOW_OPEN escape hatch works", () => {
    const prev = process.env.XCLAW_GATEWAY_ALLOW_OPEN;
    process.env.XCLAW_GATEWAY_ALLOW_OPEN = "1";
    const r = assertBindSafety({ gateway: { host: "0.0.0.0" } });
    if (prev === undefined) delete process.env.XCLAW_GATEWAY_ALLOW_OPEN;
    else process.env.XCLAW_GATEWAY_ALLOW_OPEN = prev;
    assert.equal(r.ok, true);
  });
});
