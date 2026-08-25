import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createApprovalGate,
  UNANSWERED_APPROVAL_REASONS,
} from "../src/security/approvals.mjs";
import {
  planApprovalOutcome,
  UNANSWERED_APPROVAL_REASONS as LOOP_UNANSWERED_REASONS,
} from "../src/agent/loop-stages.mjs";

// v3.180.1 — pendency is a DECLARED state, not an inference.
//
// 3.180.0 fixed the loop reading `pendingId` as "still pending" (authorize
// stamps that id onto every human-path answer, verdicts included, so every
// operator Deny was misread). The replacement enumerated reason strings, which
// is a convention the gate was not obliged to honour: any future verdict reason
// containing "timeout" would have reproduced the same bug one level up.
//
// The gate now states it outright. These tests pin the contract at the source:
// every answer authorize returns carries a boolean `awaitingHuman`, and the
// deny/timeout pair — identical in every other respect, both carrying a
// pendingId — must disagree on it.

function gateCfg(extra = {}) {
  return {
    security: {
      autoApprove: false,
      approvalPolicy: "always",
      revalidateOnDecide: false,
      bindSystemRunPlan: false,
      ...extra,
    },
  };
}

/** Drive a real pending ask and resolve it however `settle` says. */
async function askAndSettle(gate, settle, opts = {}) {
  let captured = null;
  const res = await gate.authorize(
    "xclaw_bash",
    { command: "echo hi" },
    {
      timeoutMs: 60_000,
      ...opts,
      onPending: (p) => {
        captured = p;
        // runs inside the real approval window, exactly as the loop's onEvent does
        settle(p, gate);
      },
    }
  );
  return { res, pending: captured };
}

describe("approval pendency is a declared field, not an inference", () => {
  it("the gate stamps awaitingHuman on every answer it returns", async () => {
    const gate = createApprovalGate(gateCfg({ allowedTools: ["xclaw_bash"] }));

    // policy verdict — never reaches a human at all
    const blocked = await gate.authorize("definitely_not_a_tool", {});
    assert.equal(typeof blocked.awaitingHuman, "boolean", "policy verdict must declare pendency");
    assert.equal(blocked.awaitingHuman, false, "a policy block is answered, not pending");
    assert.equal(blocked.ok, false);

    // human APPROVE
    const approved = await askAndSettle(gate, (p, g) => g.decide(p.id, true, "ok"));
    assert.equal(approved.res.ok, true);
    assert.equal(approved.res.awaitingHuman, false, "an approval is an answer");

    // human DENY — the 3.180.0 regression. Carries a pendingId like every
    // human-path answer; must NOT read as pending.
    const denied = await askAndSettle(gate, (p, g) => g.decide(p.id, false, "no"));
    assert.equal(denied.res.ok, false);
    assert.equal(denied.res.reason, "denied");
    assert.ok(denied.res.pendingId, "deny still carries the id (that is the trap)");
    assert.equal(denied.res.awaitingHuman, false, "a deny is an ANSWER, not a pending ask");

    // TIMEOUT — nobody answered. Same shape as deny down to the pendingId,
    // opposite verdict on pendency. This pair is what makes the field load-
    // bearing: a constant cannot satisfy both.
    const timedOut = await askAndSettle(gate, () => {}, { timeoutMs: 25 });
    assert.equal(timedOut.res.ok, false);
    assert.equal(timedOut.res.reason, "timeout");
    assert.ok(timedOut.res.pendingId, "timeout carries the id too");
    assert.equal(timedOut.res.awaitingHuman, true, "an unanswered window is still open");
  });

  it("the loop reads the gate's claim rather than re-deriving it", () => {
    const inp = { name: "xclaw_bash", args: {}, formatBlockedReply: () => "blocked" };

    // A reason the loop's own list has never heard of. The gate says it is
    // unanswered; the loop must believe the gate.
    const novel = planApprovalOutcome(
      { ok: false, reason: "awaiting_second_approver", pendingId: "apr_1", awaitingHuman: true },
      inp
    );
    assert.equal(novel.action, "stop", "declared-pending must stop the turn");
    assert.equal(novel.event.phase, "approval_required");

    // Inverse: a reason that LOOKS like the timeout family but is a verdict.
    // Substring matching on "timeout" got this wrong; the declared field does not.
    const verdict = planApprovalOutcome(
      { ok: false, reason: "exec_timeout_policy", pendingId: "apr_2", awaitingHuman: false },
      inp
    );
    assert.equal(verdict.action, "deny", "declared-answered must continue the turn");
    assert.equal(verdict.event.phase, "denied");
    assert.equal(verdict.event.timedOut, false);
  });

  it("falls back to the enumerated reasons for gates that predate the field", () => {
    const inp = { name: "xclaw_bash", args: {}, formatBlockedReply: () => "blocked" };
    // injected test doubles / the deprecated check() shape carry no awaitingHuman
    for (const reason of ["timeout", "sla_timeout", "sla_timeout_critical", "pending"]) {
      const r = planApprovalOutcome({ ok: false, reason, pendingId: "apr_1" }, inp);
      assert.equal(r.action, "stop", reason);
    }
    for (const reason of ["denied", "plan_drift", "not_allowlisted", "critical_denied"]) {
      const r = planApprovalOutcome({ ok: false, reason, pendingId: "apr_1" }, inp);
      assert.equal(r.action, "deny", reason);
    }
    assert.equal(
      planApprovalOutcome({ ok: false, pending: true, pendingId: "apr_1" }, inp).action,
      "stop",
      "deprecated check() shape"
    );
  });

  it("the loop's fallback list and the gate's list stay identical", () => {
    // loop-stages.mjs is deliberately dependency-free, so the set is duplicated
    // there instead of imported. Pin them equal so the copies cannot drift.
    assert.deepEqual(
      [...LOOP_UNANSWERED_REASONS].sort(),
      [...UNANSWERED_APPROVAL_REASONS].sort(),
      "add new unanswered-window reasons to BOTH modules"
    );
  });

  it("every unanswered reason the gate can actually produce is on the list", async () => {
    // resolveExpiredApproval is the only other producer of an unanswered
    // resolution; its deny reasons must be covered or the SLA path regresses.
    const { resolveExpiredApproval } = await import("../src/security/approval-ttl.mjs");
    for (const risk of ["low", "critical"]) {
      const r = resolveExpiredApproval({ tool: "xclaw_bash", risk }, { security: {} });
      assert.equal(r.ok, false, risk);
      assert.ok(
        UNANSWERED_APPROVAL_REASONS.has(r.reason),
        `SLA reason ${r.reason} must be recognised as an unanswered window`
      );
    }
    // the auto-approve SLA branch is ok:true, so it is an answer by definition
    const approve = resolveExpiredApproval(
      { tool: "xclaw_bash", risk: "low" },
      { security: { approvalSlaAction: "approve" } }
    );
    assert.equal(approve.ok, true);
  });
});
