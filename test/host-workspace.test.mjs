/**
 * P1 — host workspace detection for absolute-path swarm goals
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldUseHostWorkspace } from "../src/agents/spawn.mjs";

describe("shouldUseHostWorkspace", () => {
  it("explicit true/false", () => {
    assert.equal(shouldUseHostWorkspace({ hostWorkspace: true }, ""), true);
    assert.equal(shouldUseHostWorkspace({ hostWorkspace: false }, "/tmp/x"), false);
  });

  it("detects /tmp absolute goals", () => {
    assert.equal(
      shouldUseHostWorkspace({}, "Write /tmp/xclaw-proof.txt with ok"),
      true
    );
  });

  it("relative goals stay isolated", () => {
    assert.equal(
      shouldUseHostWorkspace({}, "Create README.md in the workspace"),
      false
    );
  });

  it("env forces host", () => {
    process.env.XCLAW_SWARM_HOST_WORKSPACE = "1";
    assert.equal(shouldUseHostWorkspace({}, "relative only"), true);
    delete process.env.XCLAW_SWARM_HOST_WORKSPACE;
  });
});
