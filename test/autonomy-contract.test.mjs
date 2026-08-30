/**
 * Offline contract pins for the autonomy directive.
 * These do not call a live model. They prove the runtime distinguishes
 * the 12 failure classes from "the model said so."
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeStopReason, terminalStatus } from "../src/agent/loop-stages.mjs";
import { isResumableAgentRun } from "../src/agent/run-resume.mjs";
import { deriveGoalVerifyChecks } from "../src/agent/complete-gate.mjs";
import { createLoopGuard } from "../src/agent/loop-guards.mjs";

describe("autonomy contract (hermetic)", () => {
  it("1/10 long-horizon: a turn cap is not completion", () => {
    assert.equal(terminalStatus("maxTurns"), "maxTurns");
    assert.notEqual(terminalStatus("maxTurns"), "completed");
  });

  it("2/11 crash: active and maxTurns snapshots are resumable; kill is not", () => {
    assert.equal(isResumableAgentRun({ status: "active", stopReason: "segment" }), true);
    assert.equal(isResumableAgentRun({ status: "maxTurns", stopReason: "maxTurns" }), true);
    assert.equal(isResumableAgentRun({ status: "aborted", stopReason: "aborted" }), false);
  });

  it("3 false Done: a file-create goal derives a check the loop can reject", () => {
    const c = deriveGoalVerifyChecks("Create /tmp/xclaw-hello.txt with text ok");
    assert.equal(c[0].type, "file_contains");
    assert.equal(computeStopReason({ unverifiedStop: true }), "unverified");
    assert.notEqual(terminalStatus("unverified"), "completed");
    const smoke = deriveGoalVerifyChecks(
      "Write a file hello.txt containing exactly: hello xclaw\nThen stop."
    );
    assert.equal(smoke[0].type, "file_contains");
    assert.equal(smoke[0].path, "hello.txt");
    assert.equal(smoke[0].text, "hello xclaw");
    const dot = deriveGoalVerifyChecks("touch .gitignore");
    assert.equal(dot[0].type, "file_exists");
    assert.equal(dot[0].path, ".gitignore");
  });

  it("6 no-progress: repeated identical calls trip the loop guard", () => {
    const g = createLoopGuard({ warningThreshold: 3, criticalThreshold: 5, historySize: 20 });
    let last;
    for (let i = 0; i < 6; i++) {
      last = g.detect("xclaw_bash", { command: "echo same" });
      g.record("xclaw_bash", { command: "echo same" }, "ok");
    }
    assert.equal(last.stuck, true);
  });

  it("chat is not a mission: questions derive no checks", () => {
    assert.deepEqual(deriveGoalVerifyChecks("what time is it?"), []);
    assert.equal(computeStopReason({}), "natural");
    assert.equal(terminalStatus("natural"), "completed");
  });
});
