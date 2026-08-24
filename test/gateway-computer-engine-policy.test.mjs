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
  it("defaults to native and validates ok (W4 flip); explicit bundle is the fallback marker", () => {
    const prev = process.env.XCLAW_COMPUTER_ENGINE;
    const prevN = process.env.XCLAW_COMPUTER_NATIVE;
    delete process.env.XCLAW_COMPUTER_ENGINE;
    delete process.env.XCLAW_COMPUTER_NATIVE;
    try {
      assert.equal(policyResolveComputerEngine({}), "native");
      assert.equal(isBundleFallback({}), false);
      // explicit bundle now reads as the legacy-fallback path
      assert.equal(isBundleFallback({ computer: { engine: "bundle" } }), true);
      const v = validateComputerEnginePolicy({});
      assert.equal(v.ok, true);
      assert.equal(v.engine, "native");
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
      assert.equal(s.engine, "native");
      assert.ok(s.validation);
      assert.equal(s.validation.ok, true);
    } finally {
      if (prev !== undefined) process.env.XCLAW_COMPUTER_ENGINE = prev;
      else delete process.env.XCLAW_COMPUTER_ENGINE;
    }
  });
});
