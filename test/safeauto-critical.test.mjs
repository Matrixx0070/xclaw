/**
 * `security.safeAuto` must not outrank the critical tier.
 *
 * safeAuto is a list of tool NAMES; risk is assessed per CALL. Those are not
 * the same question, and the gate answered the first one. `file_read` is a
 * read-safe family — which is why it is in the shipped default list — but
 * `file_read ~/.xclaw/credentials.json` is the most direct exfiltration path
 * there is, and `assessRisk` already tiers it "critical" for exactly that
 * reason ("touches credential/secret material", risk.mjs). A name-keyed
 * short-circuit placed ahead of the critical check threw that verdict away:
 * the tool auto-ran, no human saw it, and because the decision journal only
 * records the bypass path, nothing recorded that it happened.
 *
 * The asymmetry is the tell. Every other permissive path in `needsApproval`
 * deliberately stops short of critical — `bypassApprovals` (Trust Sprint),
 * blanket `autoApprove` (A2), and `autoApproveMaxTier: "critical"` (M5) all
 * escalate, each with a comment saying so. safeAuto was the one path that did
 * not, in BOTH of its occurrences: the risk-tier branch and the legacy
 * `approvalPolicy` branch below it. The prod overlay ships a safeAuto list and
 * no `autoApproveMaxTier`, so the second branch is the live one.
 *
 * Sweep #41 (test/prod-overlay-safeauto.test.mjs) pinned the CONTENTS of the
 * list and even documented the mechanism as "an unconditional auto-approve
 * short-circuit" — but asserting which names are listed says nothing about
 * what a listed name does at critical tier, so the control flow stayed
 * unpinned. This file pins the mechanism.
 *
 * `criticalOverride: "legacy"` remains the explicit escape hatch, as it is for
 * every other path.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createApprovalGate } from "../src/security/approvals.mjs";
import { assessRisk } from "../src/security/risk.mjs";

const SECRET = "/work/.env";
const BENIGN = "/work/notes.txt";
const READS = ["file_read", "xclaw_file_read"];

/** The real verdict the gate is handed, not a hand-built stand-in. */
const riskOf = (tool, path) =>
  assessRisk({ tool, args: { path }, workingDir: "/work", cfg: {}, context: {} });

const gateWith = (security) => createApprovalGate({ security: { bindSystemRunPlan: false, ...security } });

/** Live-shaped: a tier ceiling plus a safeAuto list. */
const TIERED = { autoApprove: false, autoApproveMaxTier: "low", safeAuto: READS };
/** Prod/supervised-shaped: a policy and a safeAuto list, no tier ceiling. */
const LEGACY = { autoApprove: false, approvalPolicy: "risky", safeAuto: READS };

describe("assessRisk tiers a credential read critical (premise)", () => {
  for (const tool of READS) {
    test(`${tool} of a dotenv path is critical`, () => {
      const r = riskOf(tool, SECRET);
      assert.equal(r.tier, "critical", JSON.stringify(r));
      assert.ok(
        (r.reasons || []).some((s) => /credential|secret/i.test(s)),
        JSON.stringify(r.reasons)
      );
    });

    test(`${tool} of an ordinary file is not critical`, () => {
      assert.notEqual(riskOf(tool, BENIGN).tier, "critical");
    });
  }
});

describe("a safeAuto tool still pends when the CALL is critical", () => {
  for (const [label, security] of [
    ["tier ceiling", TIERED],
    ["legacy policy", LEGACY],
  ]) {
    for (const tool of READS) {
      test(`${label}: ${tool} of a credential path is not auto-approved`, () => {
        const gate = gateWith(security);
        assert.equal(
          gate.needsApproval(tool, riskOf(tool, SECRET)),
          true,
          "safeAuto membership discarded the critical verdict"
        );
      });
    }

    test(`${label}: the same tool on an ordinary path still auto-approves`, () => {
      const gate = gateWith(security);
      for (const tool of READS) {
        assert.equal(gate.needsApproval(tool, riskOf(tool, BENIGN)), false, tool);
      }
    });
  }

  test("approvalPolicy:'never' does not auto-approve a critical call either", () => {
    // The one remaining permissive path that outranked critical. Every shipped
    // profile pairs it with autoApprove:true (which escalates), so this is the
    // hand-written-config case — the same defect, reached by a different key.
    const gate = gateWith({ autoApprove: false, approvalPolicy: "never", safeAuto: READS });
    assert.equal(gate.needsApproval("file_read", riskOf("file_read", SECRET)), true);
    assert.equal(gate.needsApproval("bash", riskOf("bash", BENIGN)), false, "never still means never");
  });

  test("end to end: authorize does not hand back an auto approval", async () => {
    for (const security of [TIERED, LEGACY]) {
      const gate = gateWith(security);
      const r = await gate.authorize("file_read", { path: SECRET }, { timeoutMs: 150 });
      assert.notEqual(r.mode, "auto", `auto-approved at ${r.risk?.tier}: ${JSON.stringify(r)}`);
      assert.equal(r.approved, undefined, JSON.stringify(r));
    }
  });
});

describe("criticalOverride:'legacy' is still the way out", () => {
  for (const [label, security] of [
    ["tier ceiling", TIERED],
    ["legacy policy", LEGACY],
  ]) {
    test(`${label}: pre-3.155 behaviour is restorable`, () => {
      const gate = gateWith({ ...security, criticalOverride: "legacy" });
      assert.equal(gate.needsApproval("file_read", riskOf("file_read", SECRET)), false);
    });
  }
});

describe("nothing else about safeAuto moved", () => {
  test("a listed tool with no risk assessment still auto-approves", () => {
    // risk === null is the degraded path (assessRisk threw); it must keep
    // behaving exactly as before, or a broken assessor becomes an outage.
    for (const security of [TIERED, LEGACY]) {
      assert.equal(gateWith(security).needsApproval("file_read", null), false);
    }
  });

  test("an unlisted dangerous tool is unaffected", () => {
    const gate = gateWith(LEGACY);
    assert.equal(gate.needsApproval("bash", riskOf("bash", BENIGN)), true);
  });
});
