import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  policyResolveComputerEngine,
  validateComputerEnginePolicy,
  isBundleFallback,
  computerEnginePolicySnapshot,
  ALLOWED_DEFAULT_ENGINES,
} from "../src/gateway/policy/computer-engine.mjs";

describe("gateway policy/computer-engine", () => {
  it("defaults to bundle and validates ok", () => {
    const prev = process.env.XCLAW_COMPUTER_ENGINE;
    const prevN = process.env.XCLAW_COMPUTER_NATIVE;
    delete process.env.XCLAW_COMPUTER_ENGINE;
    delete process.env.XCLAW_COMPUTER_NATIVE;
    try {
      assert.equal(policyResolveComputerEngine({}), "bundle");
      assert.equal(isBundleFallback({}), false);
      const v = validateComputerEnginePolicy({});
      assert.equal(v.ok, true);
      assert.equal(v.engine, "bundle");
      assert.ok(ALLOWED_DEFAULT_ENGINES.includes("bundle"));
      assert.ok(ALLOWED_DEFAULT_ENGINES.includes("native"));
    } finally {
      if (prev !== undefined) process.env.XCLAW_COMPUTER_ENGINE = prev;
      else delete process.env.XCLAW_COMPUTER_ENGINE;
      if (prevN !== undefined) process.env.XCLAW_COMPUTER_NATIVE = prevN;
      else delete process.env.XCLAW_COMPUTER_NATIVE;
    }
  });

  it("explicit native escape hatch is allowed", () => {
    const v = validateComputerEnginePolicy({
      computer: { engine: "native" },
    });
    assert.equal(v.ok, true);
    assert.equal(v.engine, "native");
  });

  it("snapshot includes controlPlane marker", () => {
    const prev = process.env.XCLAW_COMPUTER_ENGINE;
    delete process.env.XCLAW_COMPUTER_ENGINE;
    delete process.env.XCLAW_COMPUTER_NATIVE;
    try {
      const s = computerEnginePolicySnapshot({});
      assert.equal(s.controlPlane, "gateway");
      assert.equal(s.capabilityPlane, "computer");
      assert.equal(s.engine, "bundle");
      assert.ok(s.validation);
      assert.equal(s.validation.ok, true);
    } finally {
      if (prev !== undefined) process.env.XCLAW_COMPUTER_ENGINE = prev;
      else delete process.env.XCLAW_COMPUTER_ENGINE;
    }
  });
});
