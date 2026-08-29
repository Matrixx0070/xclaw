import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyProfile } from "../src/config/profiles.mjs";
import { createApprovalGate } from "../src/security/approvals.mjs";
import { autonomyOverlay } from "../src/config/autonomy-policy.mjs";
import toolConcurrency from "../src/agent/tool-concurrency.mjs";
import { DEFAULT_CONFIG } from "../src/config/defaults.mjs";
import { ROLE_TOOL_PACKS } from "../src/providers/role-router.mjs";

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

  /**
   * The two spawn tools are the same capability under two names:
   * createSpawnTool serves `xclaw_spawn_subagent` from the loop, the registry
   * serves `xclaw_spawn_agent`, and either one hands a slice of work to a
   * child agent that then runs tools of its own. They assess to the same tier.
   * Only one was ever typed into an approval list, and it is the one no
   * shipped pack grants — so the protected twin was unreachable and the
   * reachable twin was unprotected.
   */
  it("both spawn tools pend, not just the one no pack grants", () => {
    const prod = createApprovalGate(applyProfile({ profile: "prod" }));
    const base = applyProfile({ profile: "prod" });
    const overlay = autonomyOverlay("supervised");
    const supervised = createApprovalGate({
      ...base,
      security: { ...base.security, ...overlay.security },
    });
    const bare = createApprovalGate({
      ...DEFAULT_CONFIG,
      security: { ...DEFAULT_CONFIG.security, autoApprove: false, approvalPolicy: "risky" },
    });
    for (const name of ["xclaw_spawn_agent", "xclaw_spawn_subagent"]) {
      assert.equal(prod.needsApproval(name, LOW), true, `${name} auto-runs in prod`);
      assert.equal(supervised.needsApproval(name, LOW), true, `${name} auto-runs under supervised`);
      assert.equal(bare.needsApproval(name, LOW), true, `${name} auto-runs on the default list`);
    }
  });

  /**
   * FORCE_SERIAL was the source of truth the earlier cases graded against, and
   * it is a hand-typed list too — it never named `xclaw_spawn_agent`, so every
   * invariant above passed while a pack-granted delegation tool auto-ran.
   *
   * A shipped pack is the one source that cannot silently omit a served tool:
   * whatever a pack grants IS handed to the model. So every pack-granted name
   * must have been classified by somebody — it pends, or it is in safeAuto, or
   * it appears below as a deliberate auto-run. Adding a tool to a pack without
   * deciding which of the three it is now fails here instead of shipping.
   */
  const ACKNOWLEDGED_AUTO = new Set([
    "glob",              // enumeration, read-only
    "web_search",        // third-party read, loosened deliberately in 3.351.0
    "xclaw_web_search",
    "xclaw_skill",       // loads skill text
    "python_session",    // exec, but assessRisk tiers it per call and pends it
  ]);

  it("every tool a shipped pack grants has been classified", () => {
    const gate = createApprovalGate(applyProfile({ profile: "prod" }));
    const safeAuto = new Set(gate.policyInfo().safeAuto || []);
    const granted = new Set(
      Object.values(ROLE_TOOL_PACKS).filter(Array.isArray).flat()
    );
    const unclassified = [...granted].filter(
      (name) =>
        !gate.needsApproval(name, LOW) &&
        !safeAuto.has(name) &&
        !ACKNOWLEDGED_AUTO.has(name)
    );
    assert.deepEqual(
      unclassified,
      [],
      `pack-granted tools on no list, so they auto-run: ${unclassified.join(", ")}`
    );
  });

  it("read-only tools still auto-run", () => {
    const gate = createApprovalGate(applyProfile({ profile: "prod" }));
    for (const name of ["xclaw_file_read", "file_read", "glob", "grep"]) {
      assert.equal(gate.needsApproval(name, LOW), false, `${name} newly pends`);
    }
  });
});
