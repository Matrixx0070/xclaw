import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyProfile } from "../src/config/profiles.mjs";
import { createApprovalGate } from "../src/security/approvals.mjs";
import { autonomyOverlay } from "../src/config/autonomy-policy.mjs";
import toolConcurrency from "../src/agent/tool-concurrency.mjs";
import { DEFAULT_CONFIG } from "../src/config/defaults.mjs";

/**
 * `approvalPolicy: "risky"` decides by NAME: its last line is
 * `requireApproval.has(n)`, so a tool the list never anticipated auto-runs.
 * The list was a hand-typed subset of the tools the host actually serves —
 * `xclaw_file_edit` and `xclaw_computer_act` are served by the computer
 * server, are declared mutating by this codebase's own FORCE_SERIAL set, and
 * were on no approval list at all. `xclaw_browser_tab` and
 * `xclaw_computer_act` assess to the SAME risk tier; one pended and one did
 * not, decided purely by whether someone had typed the name.
 *
 * Risk is pinned to tier "low" throughout so these grade LIST MEMBERSHIP and
 * cannot pass for the unrelated reason that a tier branch caught the call.
 */
const LOW = { tier: "low", factors: {}, reasons: [] };

/** Tools the live computer server serves that change state when they run. */
const SERVED_MUTATORS = ["xclaw_bash", "xclaw_file_write", "xclaw_file_edit", "xclaw_browser_tab", "xclaw_computer_act"];

describe("mutating tools require approval", () => {
  it("prod pends every mutating tool the host serves", () => {
    const gate = createApprovalGate(applyProfile({ profile: "prod" }));
    for (const name of SERVED_MUTATORS) {
      assert.equal(gate.needsApproval(name, LOW), true, `${name} auto-runs in prod`);
    }
  });

  it("the supervised autonomy overlay pends them too", () => {
    const base = applyProfile({ profile: "prod" });
    const overlay = autonomyOverlay("supervised");
    const gate = createApprovalGate({ ...base, security: { ...base.security, ...overlay.security } });
    for (const name of SERVED_MUTATORS) {
      assert.equal(gate.needsApproval(name, LOW), true, `${name} auto-runs under supervised`);
    }
    // The overlay is DERIVED from TOOL_RISK, so this is also what grades every
    // entry in that table rather than just the five the host serves today.
    const missing = [...toolConcurrency.FORCE_SERIAL].filter(
      (name) => !gate.needsApproval(name, LOW)
    );
    assert.deepEqual(missing, [], `mutating tools that auto-run under supervised: ${missing.join(", ")}`);
  });

  it("no tool this codebase calls mutating is left off both lists", () => {
    const gate = createApprovalGate(applyProfile({ profile: "prod" }));
    const info = gate.policyInfo();
    const safeAuto = new Set(info.safeAuto || []);
    const missing = [...toolConcurrency.FORCE_SERIAL].filter(
      (name) => !gate.needsApproval(name, LOW) && !safeAuto.has(name)
    );
    assert.deepEqual(missing, [], `mutating tools that auto-run in prod: ${missing.join(", ")}`);
  });

  it("the no-profile default list covers them too", () => {
    // Reached whenever a config sets autoApprove:false without naming a
    // profile — a path applyProfile never touches, so the prod cases above
    // cannot speak for it.
    const gate = createApprovalGate({
      ...DEFAULT_CONFIG,
      security: { ...DEFAULT_CONFIG.security, autoApprove: false, approvalPolicy: "risky" },
    });
    for (const name of SERVED_MUTATORS) {
      assert.equal(gate.needsApproval(name, LOW), true, `${name} auto-runs on the default list`);
    }
    const missing = [...toolConcurrency.FORCE_SERIAL].filter(
      (name) => !gate.needsApproval(name, LOW)
    );
    assert.deepEqual(missing, [], `mutating tools that auto-run by default: ${missing.join(", ")}`);
  });

  it("read-only tools still auto-run", () => {
    const gate = createApprovalGate(applyProfile({ profile: "prod" }));
    for (const name of ["xclaw_file_read", "file_read", "glob", "grep"]) {
      assert.equal(gate.needsApproval(name, LOW), false, `${name} newly pends`);
    }
  });
});
