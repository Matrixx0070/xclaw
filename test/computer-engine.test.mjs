import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveComputerEngine,
  resolveComputerEntryPath,
  describeComputerEngine,
  isNativeComputer,
  DEFAULT_COMPUTER_ENGINE,
} from "../src/computer/engine.mjs";

describe("computer engine (single bundle engine, ADR 0006)", () => {
  it("defaults to bundle and every legacy selector resolves to bundle", () => {
    const prev = process.env.XCLAW_COMPUTER_ENGINE;
    const prevN = process.env.XCLAW_COMPUTER_NATIVE;
    delete process.env.XCLAW_COMPUTER_ENGINE;
    delete process.env.XCLAW_COMPUTER_NATIVE;
    try {
      assert.equal(DEFAULT_COMPUTER_ENGINE, "bundle");
      assert.equal(resolveComputerEngine({}), "bundle");
      assert.equal(isNativeComputer({}), false);
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
          "bundle",
          `selector ${sel} must resolve bundle`
        );
      }
      assert.equal(
        resolveComputerEngine({ computer: { nativeServer: true } }),
        "bundle"
      );
    } finally {
      if (prev !== undefined) process.env.XCLAW_COMPUTER_ENGINE = prev;
      else delete process.env.XCLAW_COMPUTER_ENGINE;
      if (prevN !== undefined) process.env.XCLAW_COMPUTER_NATIVE = prevN;
      else delete process.env.XCLAW_COMPUTER_NATIVE;
    }
  });

  it("entry path is the bundle and describe reports the unified engine", () => {
    const entry = resolveComputerEntryPath({}, "/repo");
    assert.equal(entry, "/repo/src/computer/xclaw-server.mjs");
    const d = describeComputerEngine({}, process.cwd());
    assert.equal(d.engine, "bundle");
    assert.equal(d.strategyPhase, "unified-bundle");
    assert.equal(d.policy.singleEngine, true);
    assert.equal(d.entryExists, true);
  });
});
