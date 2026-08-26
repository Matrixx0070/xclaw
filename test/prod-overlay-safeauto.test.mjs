import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildProdSecurityOverlay,
  TOOL_RISK,
} from "../src/security/policy-matrix.mjs";
import { applyAutonomyLevel } from "../src/config/autonomy-policy.mjs";
import { createApprovalGate } from "../src/security/approvals.mjs";

// Sweep #41 (v3.223.0) — prod/supervised auto-approve list is the live gate's
// auto-approve short-circuit, and NOTHING pinned its contents.
//
// buildProdSecurityOverlay() (src/security/policy-matrix.mjs) is the SOLE
// producer of security.safeAuto / security.requireApproval for the supervised
// overlay — applied on every `prod` OR `dev` profile via
// autonomyOverlay("supervised") → applyAutonomyLevel (autonomy-policy.mjs:59,
// 125-130) whenever the operator has not hand-tuned those keys. policy-matrix
// .mjs had ZERO test references (direct or indirect): no test asserted the
// safeAuto/requireApproval list CONTENTS, and no test drove a prod-overlay gate
// to prove a dangerous tool actually pends because of them.
//
// Why the list is security-decisive: the overlay deliberately does NOT set
// autoApproveMaxTier, so in a prod/supervised config the gate's
// effectiveMaxTier is null → needsApproval's risk-tier path (approvals.mjs:281)
// is skipped and the LEGACY path governs. There, `safeAuto.has(n)` (line 290)
// is an unconditional auto-approve short-circuit, and only listed
// `requireApproval` names pend (line 302). So an exec/write tool leaking into
// safeAuto — or dropping out of requireApproval — auto-runs unapproved in prod.
//
// Blind spot proof (mutation): widening the safeAuto filter to
// `r === "safe" || r === "exec"` leaked bash/shell into the prod auto-approve
// list; the FULL suite stayed GREEN 3636/3636/0 — bash auto-approving under
// supervised mode was entirely unpinned. These tests redden under that mutation
// (and under any requireApproval-narrowing) in both directions.

describe("prod/supervised security overlay — safeAuto/requireApproval contents", () => {
  it("safeAuto lists ONLY read-safe tools; every exec/write/network tool is excluded", () => {
    const { safeAuto, requireApproval } = buildProdSecurityOverlay();
    const safeSet = new Set(safeAuto);

    // Every read-safe tool auto-approves...
    for (const [tool, risk] of Object.entries(TOOL_RISK)) {
      if (risk === "safe") {
        assert.ok(safeSet.has(tool), `safe tool ${tool} must be in safeAuto`);
      } else {
        // ...and NO dangerous tool may be on the auto-approve list.
        assert.ok(
          !safeSet.has(tool),
          `${risk} tool ${tool} must NOT be in safeAuto (auto-approve leak)`
        );
      }
    }
    // Spot-pin the tools an operator would actually be burned by.
    assert.ok(!safeSet.has("bash"), "bash must never auto-approve in prod");
    assert.ok(!safeSet.has("xclaw_bash"), "xclaw_bash must never auto-approve in prod");
    assert.ok(!safeSet.has("shell"), "shell must never auto-approve in prod");
    assert.ok(!safeSet.has("file_write"), "file_write must never auto-approve in prod");

    // The complementary requireApproval list must actually name the danger set —
    // it is the ONLY thing that pends a tool on the legacy path (line 302).
    const reqSet = new Set(requireApproval);
    for (const [tool, risk] of Object.entries(TOOL_RISK)) {
      if (risk !== "safe") {
        assert.ok(reqSet.has(tool), `${risk} tool ${tool} must be in requireApproval`);
      } else {
        assert.ok(!reqSet.has(tool), `safe tool ${tool} must NOT be in requireApproval`);
      }
    }
  });

  it("the gate honors the overlay: bash/file_write/browser_tab PEND, reads auto-approve", () => {
    // Feed the overlay's own lists straight into the gate — env-independent.
    const gate = createApprovalGate({ security: buildProdSecurityOverlay() });

    // Dangerous tools must pend (needsApproval === true) under supervised mode.
    assert.equal(gate.needsApproval("bash", { tier: "risky" }), true, "bash must pend");
    assert.equal(gate.needsApproval("xclaw_bash", { tier: "risky" }), true, "xclaw_bash must pend");
    assert.equal(gate.needsApproval("shell", { tier: "risky" }), true, "shell must pend");
    assert.equal(gate.needsApproval("file_write", { tier: "risky" }), true, "file_write must pend");
    assert.equal(gate.needsApproval("browser_tab", { tier: "risky" }), true, "browser_tab must pend");

    // Read-safe tools auto-approve (needsApproval === false).
    assert.equal(gate.needsApproval("file_read", { tier: "safe" }), false, "file_read must auto-approve");
    assert.equal(gate.needsApproval("list_dir", { tier: "safe" }), false, "list_dir must auto-approve");
    assert.equal(gate.needsApproval("grep", { tier: "safe" }), false, "grep must auto-approve");
  });

  it("a prod profile wires the overlay lists and leaves autoApproveMaxTier unset (legacy path governs)", () => {
    // resolveAutonomyLevel lets XCLAW_AUTONOMY_LEVEL / XCLAW_PROFILE win over
    // cfg — neutralize them so this pins the profile→overlay path deterministically.
    const saved = {
      lvl: process.env.XCLAW_AUTONOMY_LEVEL,
      prof: process.env.XCLAW_PROFILE,
    };
    delete process.env.XCLAW_AUTONOMY_LEVEL;
    delete process.env.XCLAW_PROFILE;
    try {
      const cfg = applyAutonomyLevel({ profile: "prod" });
      assert.equal(cfg.autonomy.level, "supervised", "prod profile → supervised");
      assert.equal(cfg.security.autoApprove, false, "supervised is not blanket auto-approve");

      // The overlay lists are wired in (operator did not override them).
      assert.ok(
        !cfg.security.safeAuto.includes("bash"),
        "prod safeAuto must exclude bash"
      );
      assert.ok(
        cfg.security.requireApproval.includes("bash"),
        "prod requireApproval must include bash"
      );

      // The overlay deliberately does NOT set autoApproveMaxTier — this is WHY
      // safeAuto/requireApproval (not risk tiering) decide auto-approval here.
      assert.equal(
        cfg.security.autoApproveMaxTier,
        undefined,
        "prod overlay must not set autoApproveMaxTier"
      );

      // End-to-end: the wired config pends bash and auto-approves a read.
      const gate = createApprovalGate(cfg);
      assert.equal(gate.needsApproval("bash", { tier: "risky" }), true, "wired prod cfg must pend bash");
      assert.equal(gate.needsApproval("file_read", { tier: "safe" }), false, "wired prod cfg auto-approves reads");
    } finally {
      if (saved.lvl === undefined) delete process.env.XCLAW_AUTONOMY_LEVEL;
      else process.env.XCLAW_AUTONOMY_LEVEL = saved.lvl;
      if (saved.prof === undefined) delete process.env.XCLAW_PROFILE;
      else process.env.XCLAW_PROFILE = saved.prof;
    }
  });
});
