import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTransientError } from "../src/utils/backoff.mjs";

describe("computer error classification", () => {
  it("ECONNREFUSED is transient (retryable)", () => {
    const err = new Error("connect ECONNREFUSED");
    err.code = "ECONNREFUSED";
    assert.equal(isTransientError(err), true);
  });

  it("ETIMEDOUT is transient", () => {
    const err = new Error("timeout");
    err.code = "ETIMEDOUT";
    assert.equal(isTransientError(err), true);
  });
});

describe("ensureComputer module loads", () => {
  it("exports ensureComputer", async () => {
    const mod = await import("../src/computer/ensure.mjs");
    assert.equal(typeof mod.ensureComputer, "function");
  });
});
