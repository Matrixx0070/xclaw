import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGatewayAuth } from "../src/gateway/auth.mjs";

// Review finding (3.95.1): /cost, /cost/pause, /usage, /logs were added only
// to the STRICT protection list — a non-strict deployment with a token set
// left POST /cost/pause (state-changing: pauses ALL spend) and the
// session-preview-exposing usage/logs reads unauthenticated. Both branches
// must protect them.

const PATHS = ["/cost", "/cost/pause", "/usage", "/logs", "/logs/run?id=x"];

describe("cost/usage/logs auth coverage", () => {
  for (const strict of [true, false]) {
    it(`token required in ${strict ? "strict" : "legacy"} mode`, () => {
      const a = createGatewayAuth({ gateway: { token: "t", authStrict: strict } });
      for (const p of PATHS) {
        assert.equal(
          a.check({ url: p, headers: {} }).ok,
          false,
          `${p} must require a token (strict=${strict})`
        );
        assert.equal(
          a.check({ url: p, headers: { authorization: "Bearer t" } }).ok,
          true,
          `${p} must accept the token (strict=${strict})`
        );
      }
    });
  }
});
