import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  policyResolveComputerEngine,
  validateComputerEnginePolicy,
  computerEnginePolicySnapshot,
  ALLOWED_DEFAULT_ENGINES,
} from "../src/gateway/policy/computer-engine.mjs";

describe("gateway policy/computer-engine (single native engine)", () => {
  it("resolves native for default and legacy selectors, validates ok", () => {
    const prev = process.env.XCLAW_COMPUTER_ENGINE;
    const prevN = process.env.XCLAW_COMPUTER_NATIVE;
    delete process.env.XCLAW_COMPUTER_ENGINE;
    delete process.env.XCLAW_COMPUTER_NATIVE;
    try {
      assert.equal(policyResolveComputerEngine({}), "native");
      assert.equal(
        policyResolveComputerEngine({ computer: { engine: "bundle" } }),
        "native"
      );
      const v = validateComputerEnginePolicy({});
      assert.equal(v.ok, true);
      assert.equal(v.engine, "native");
      assert.deepEqual([...ALLOWED_DEFAULT_ENGINES], ["native"]);
      const vLegacy = validateComputerEnginePolicy({ computer: { engine: "bundle" } });
      assert.equal(vLegacy.ok, true);
      assert.equal(vLegacy.engine, "native");
    } finally {
      if (prev !== undefined) process.env.XCLAW_COMPUTER_ENGINE = prev;
      else delete process.env.XCLAW_COMPUTER_ENGINE;
      if (prevN !== undefined) process.env.XCLAW_COMPUTER_NATIVE = prevN;
      else delete process.env.XCLAW_COMPUTER_NATIVE;
    }
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
