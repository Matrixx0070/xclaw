import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyCdpError,
  lookupCuaError,
  CUA_ERROR_CATALOG,
} from "../src/computer/cua-errors.mjs";
import { CUA_TRANSIENT_CODES } from "../src/computer/cua-retry.mjs";

describe("CDP error codes", () => {
  it("catalog includes CDP family", () => {
    for (const c of [
      "CDP_ATTACH_FAILED",
      "CDP_NO_PAGE",
      "CDP_NOT_LOOPBACK",
      "CDP_SOCKET_CLOSED",
      "CDP_TIMEOUT",
      "CDP_HTTP_FAILED",
      "CDP_WS_FAILED",
      "CDP_EVAL_FAILED",
      "CDP_NAVIGATE_FAILED",
      "CDP_SCREENSHOT_FAILED",
      "CDP_INPUT_FAILED",
    ]) {
      assert.ok(CUA_ERROR_CATALOG[c], c);
      assert.ok(lookupCuaError(c).recovery);
    }
  });

  it("classifyCdpError maps messages", () => {
    assert.equal(classifyCdpError(new Error("no CDP page target available")), "CDP_NO_PAGE");
    assert.equal(classifyCdpError(new Error("CDP host 10.0.0.1 is not loopback")), "CDP_NOT_LOOPBACK");
    assert.equal(classifyCdpError(new Error("CDP socket closed")), "CDP_SOCKET_CLOSED");
    assert.equal(classifyCdpError(new Error("CDP HTTP timeout")), "CDP_TIMEOUT");
    assert.equal(classifyCdpError(new Error("connect ECONNREFUSED")), "CDP_ATTACH_FAILED");
    assert.equal(classifyCdpError(new Error("evaluate failed")), "CDP_EVAL_FAILED");
  });

  it("transient set covers CDP blips", () => {
    assert.ok(CUA_TRANSIENT_CODES.has("CDP_TIMEOUT"));
    assert.ok(CUA_TRANSIENT_CODES.has("CDP_SOCKET_CLOSED"));
    assert.ok(CUA_TRANSIENT_CODES.has("CDP_NO_PAGE"));
  });
});
