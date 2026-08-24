import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveComputerEngine,
  resolveComputerEntryPath,
  describeComputerEngine,
  isNativeComputer,
  DEFAULT_COMPUTER_ENGINE,
} from "../src/computer/engine.mjs";

describe("computer engine (single native engine, ADR 0005)", () => {
  it("defaults to native and every legacy selector resolves to native", () => {
    const prev = process.env.XCLAW_COMPUTER_ENGINE;
    const prevN = process.env.XCLAW_COMPUTER_NATIVE;
    delete process.env.XCLAW_COMPUTER_ENGINE;
    delete process.env.XCLAW_COMPUTER_NATIVE;
    try {
      assert.equal(DEFAULT_COMPUTER_ENGINE, "native");
      assert.equal(resolveComputerEngine({}), "native");
      assert.equal(isNativeComputer({}), true);
      for (const sel of [
        "native",
        "thin",
        "generated",
        "gen",
        "c3",
        "bundle",
        "full",
        "xclaw-server",
      ]) {
        assert.equal(
          resolveComputerEngine({ computer: { engine: sel } }),
          "native",
          `selector ${sel} must resolve native`
        );
      }
      assert.equal(
        resolveComputerEngine({ computer: { nativeServer: false } }),
        "native"
      );
    } finally {
      if (prev !== undefined) process.env.XCLAW_COMPUTER_ENGINE = prev;
      else delete process.env.XCLAW_COMPUTER_ENGINE;
      if (prevN !== undefined) process.env.XCLAW_COMPUTER_NATIVE = prevN;
      else delete process.env.XCLAW_COMPUTER_NATIVE;
    }
  });

  it("entry path is thin-server and describe reports the unified engine", () => {
    const entry = resolveComputerEntryPath({}, "/repo");
    assert.equal(entry, "/repo/src/computer/thin-server.mjs");
    const d = describeComputerEngine({}, process.cwd());
    assert.equal(d.engine, "native");
    assert.equal(d.strategyPhase, "unified-native");
    assert.equal(d.policy.singleEngine, true);
    assert.equal(d.entryExists, true);
  });
});
