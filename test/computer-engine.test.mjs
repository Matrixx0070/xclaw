import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveComputerEngine, isNativeComputer } from "../src/computer/engine.mjs";

describe("computer engine", () => {
  it("defaults to native", () => {
    // Clear env influence for this assertion when possible
    const prev = process.env.XCLAW_COMPUTER_ENGINE;
    const prevN = process.env.XCLAW_COMPUTER_NATIVE;
    delete process.env.XCLAW_COMPUTER_ENGINE;
    delete process.env.XCLAW_COMPUTER_NATIVE;
    try {
      assert.equal(resolveComputerEngine({}), "native");
      assert.equal(isNativeComputer({}), true);
      assert.equal(resolveComputerEngine({ computer: { engine: "bundle" } }), "bundle");
    } finally {
      if (prev !== undefined) process.env.XCLAW_COMPUTER_ENGINE = prev;
      if (prevN !== undefined) process.env.XCLAW_COMPUTER_NATIVE = prevN;
    }
  });
});
