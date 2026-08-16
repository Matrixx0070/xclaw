import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveComputerEngine,
  isNativeComputer,
  DEFAULT_COMPUTER_ENGINE,
} from "../src/computer/engine.mjs";

describe("computer engine", () => {
  it("defaults to bundle (product CDP runtime)", () => {
    const prev = process.env.XCLAW_COMPUTER_ENGINE;
    const prevN = process.env.XCLAW_COMPUTER_NATIVE;
    delete process.env.XCLAW_COMPUTER_ENGINE;
    delete process.env.XCLAW_COMPUTER_NATIVE;
    try {
      assert.equal(DEFAULT_COMPUTER_ENGINE, "bundle");
      assert.equal(resolveComputerEngine({}), "bundle");
      assert.equal(isNativeComputer({}), false);
      assert.equal(
        resolveComputerEngine({ computer: { engine: "native" } }),
        "native"
      );
      assert.equal(
        resolveComputerEngine({ computer: { engine: "bundle" } }),
        "bundle"
      );
    } finally {
      if (prev !== undefined) process.env.XCLAW_COMPUTER_ENGINE = prev;
      else delete process.env.XCLAW_COMPUTER_ENGINE;
      if (prevN !== undefined) process.env.XCLAW_COMPUTER_NATIVE = prevN;
      else delete process.env.XCLAW_COMPUTER_NATIVE;
    }
  });
});
