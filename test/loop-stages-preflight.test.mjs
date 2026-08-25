/**
 * W2 stage 1 — turn pre-flight detectors, tested in isolation with the exact
 * input shapes runAgentLoop feeds them (the audit's W2 acceptance: "the loop
 * detectors are testable and can be fed real inputs").
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateTurnPreflight } from "../src/agent/loop-stages.mjs";

const base = () => ({
  turns: 3,
  maxTurns: 15,
  totalTurnCap: 90,
  continuationEnabled: true,
  toolCallCount: 7,
  totalTokens: 12_000,
  jobSpentUsd: null,
  costStrict: false,
  costGovCheck: () => ({}),
  checkDailyBudget: async () => ({ ok: true }),
  checkJobBudget: () => ({ ok: true }),
  runBudget: { enabled: false, check: () => null },
});

describe("loop stage: turn pre-flight", () => {
  it("clean turn: no segment, no stop, no events", async () => {
    const r = await evaluateTurnPreflight(base());
    assert.equal(r.segment, null);
    assert.equal(r.stop, null);
    assert.deepEqual(r.events, []);
  });

  it("segment boundary fires exactly at turns % maxTurns === 0 (not turn 0)", async () => {
    for (const [turns, expectSegment] of [
      [0, null],
      [14, null],
      [15, 2],
      [30, 3],
      [31, null],
    ]) {
      const r = await evaluateTurnPreflight({ ...base(), turns });
      if (expectSegment === null) assert.equal(r.segment, null, `turns=${turns}`);
      else {
        assert.equal(r.segment.segment, expectSegment, `turns=${turns}`);
        assert.equal(r.segment.event.type, "segment");
        assert.match(r.segment.noticeText, /NOT finished/);
        assert.match(r.segment.noticeText, new RegExp(`${turns}/90`));
      }
    }
  });

  it("continuation disabled → no segment even on the boundary", async () => {
    const r = await evaluateTurnPreflight({
      ...base(),
      turns: 15,
      continuationEnabled: false,
    });
    assert.equal(r.segment, null);
  });

  it("per-run governor block stops with budgetStop+aborted and stamps cost", async () => {
    const r = await evaluateTurnPreflight({
      ...base(),
      costGovCheck: () => ({ blocked: true, reason: "maxToolCalls 25 reached" }),
    });
    assert.equal(r.stop.cause, "governor");
    assert.equal(r.stop.event.phase, "governor_blocked");
    assert.match(r.stop.finalTextFallback, /^COST_GOVERNOR:/);
    assert.deepEqual(r.stop.flags, { aborted: true, budgetStop: true });
    assert.ok(r.stop.stampCost.blocked);
  });

  it("a throwing governor never blocks the run (historical fail-open)", async () => {
    const r = await evaluateTurnPreflight({
      ...base(),
      costGovCheck: () => {
        throw new Error("governor exploded");
      },
    });
    assert.equal(r.stop, null);
  });

  it("daily budget !ok stops with aborted only (budgetStop stays false)", async () => {
    const r = await evaluateTurnPreflight({
      ...base(),
      checkDailyBudget: async () => ({
        ok: false,
        code: "BUDGET_EXCEEDED",
        message: "daily $25 cap hit",
      }),
    });
    assert.equal(r.stop.cause, "daily_budget");
    assert.equal(r.stop.event.code, "BUDGET_EXCEEDED");
    assert.equal(r.stop.finalTextFallback, "daily $25 cap hit");
    assert.deepEqual(r.stop.flags, { aborted: true, budgetStop: false });
  });

  it("daily soft warn passes through as a non-terminal event", async () => {
    const r = await evaluateTurnPreflight({
      ...base(),
      checkDailyBudget: async () => ({ ok: true, soft: true, spentUsd: 20 }),
    });
    assert.equal(r.stop, null);
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].phase, "soft_warn");
  });

  it("job budget checked only when jobSpentUsd is present, stop on !ok", async () => {
    let jobChecked = false;
    const inp = {
      ...base(),
      jobSpentUsd: 3.5,
      checkJobBudget: (spent) => {
        jobChecked = true;
        assert.equal(spent, 3.5);
        return { ok: false, message: "job cap" };
      },
    };
    const r = await evaluateTurnPreflight(inp);
    assert.equal(jobChecked, true);
    assert.equal(r.stop.cause, "job_budget");
    assert.equal(r.stop.finalTextFallback, "job cap");

    jobChecked = false;
    await evaluateTurnPreflight({ ...inp, jobSpentUsd: null });
    assert.equal(jobChecked, false, "no job check without jobSpentUsd");
  });

  it("ledger error: fail-open with check_error event; strict returns the error AFTER the event", async () => {
    const boom = new Error("ledger unreadable");
    const lax = await evaluateTurnPreflight({
      ...base(),
      checkDailyBudget: async () => {
        throw boom;
      },
    });
    assert.equal(lax.stop, null);
    assert.equal(lax.events[0].phase, "check_error");
    assert.equal(lax.strictError, undefined);

    const strict = await evaluateTurnPreflight({
      ...base(),
      costStrict: true,
      checkDailyBudget: async () => {
        throw boom;
      },
    });
    assert.equal(strict.strictError, boom);
    assert.equal(strict.events[0].phase, "check_error", "event survives the rethrow");
    assert.equal(strict.stop, null);
  });

  it("unattended run caps stop gracefully (budgetStop, NOT aborted)", async () => {
    const r = await evaluateTurnPreflight({
      ...base(),
      toolCallCount: 41,
      runBudget: {
        enabled: true,
        check: (u) => {
          assert.equal(u.toolCalls, 41);
          assert.equal(u.totalTokens, 12_000);
          return { reason: "toolCalls", used: 41, limit: 40 };
        },
      },
    });
    assert.equal(r.stop.cause, "run_budget");
    assert.equal(r.stop.event.type, "budget");
    assert.match(r.stop.finalTextFallback, /run budget exceeded \(toolCalls: 41\/40\)/);
    assert.deepEqual(r.stop.flags, { aborted: false, budgetStop: true });
  });

  it("segment boundary is still reported when a later check stops the turn", async () => {
    const r = await evaluateTurnPreflight({
      ...base(),
      turns: 15,
      checkDailyBudget: async () => ({ ok: false, message: "cap" }),
    });
    assert.equal(r.segment.segment, 2, "segment side effects happen before the stop");
    assert.equal(r.stop.cause, "daily_budget");
  });

  it("check order: governor beats daily budget beats run caps", async () => {
    const r = await evaluateTurnPreflight({
      ...base(),
      costGovCheck: () => ({ blocked: true, reason: "gov" }),
      checkDailyBudget: async () => ({ ok: false, message: "daily" }),
      runBudget: { enabled: true, check: () => ({ reason: "x", used: 1, limit: 0 }) },
    });
    assert.equal(r.stop.cause, "governor");
  });
});

// W2 stage 2 — pairing backfill + stop-reason classification.
import {
  planPairingBackfill,
  computeStopReason,
  terminalStatus,
} from "../src/agent/loop-stages.mjs";

describe("loop stage: pairing-invariant backfill", () => {
  const calls = [
    { id: "c1", function: { name: "xclaw_bash" } },
    { id: "c2", function: { name: "xclaw_file_read" } },
    { id: "c3", function: { name: "xclaw_file_write" } },
    { function: { name: "no-id-call" } },
  ];

  it("backfills exactly the unanswered call ids, in call order", () => {
    const messages = [
      { role: "tool", tool_call_id: "c2" },
      { role: "assistant" },
    ];
    const plan = planPairingBackfill(calls, messages);
    assert.deepEqual(plan.map((p) => p.callId), ["c1", "c3"]);
    assert.equal(plan[0].event.phase, "skipped");
    assert.equal(plan[0].event.reason, "turn_stopped");
    assert.equal(plan[0].name, "xclaw_bash");
    assert.match(plan[0].content, /Not executed/);
  });

  it("no orphans → empty plan; calls without ids are never backfilled", () => {
    const messages = [
      { role: "tool", tool_call_id: "c1" },
      { role: "tool", tool_call_id: "c2" },
      { role: "tool", tool_call_id: "c3" },
    ];
    assert.deepEqual(planPairingBackfill(calls, messages), []);
    assert.deepEqual(planPairingBackfill([], []), []);
    assert.deepEqual(planPairingBackfill(null, []), []);
  });

  it("a non-tool message with a matching id does not count as answered", () => {
    const messages = [{ role: "assistant", tool_call_id: "c1" }];
    const plan = planPairingBackfill([calls[0]], messages);
    assert.equal(plan.length, 1);
  });
});

describe("loop stage: stop-reason priority chain", () => {
  const none = {
    signalAborted: false,
    aborted: false,
    hookAbort: false,
    loopGuardStop: false,
    lastPendingApproval: null,
    toolHaltStop: false,
    budgetStop: false,
    maxTurnsStop: false,
  };

  it("clean run is natural; each flag alone maps to its reason", () => {
    assert.equal(computeStopReason(none), "natural");
    assert.equal(computeStopReason({ ...none, signalAborted: true }), "aborted");
    assert.equal(computeStopReason({ ...none, aborted: true }), "aborted");
    assert.equal(computeStopReason({ ...none, hookAbort: true }), "hook");
    assert.equal(computeStopReason({ ...none, loopGuardStop: true }), "guard");
    assert.equal(computeStopReason({ ...none, lastPendingApproval: {} }), "approval");
    assert.equal(computeStopReason({ ...none, toolHaltStop: true }), "policy");
    assert.equal(computeStopReason({ ...none, budgetStop: true }), "budget");
    assert.equal(computeStopReason({ ...none, maxTurnsStop: true }), "maxTurns");
  });

  it("priority: earlier causes win when several flags are set", () => {
    assert.equal(
      computeStopReason({ ...none, aborted: true, budgetStop: true, maxTurnsStop: true }),
      "aborted"
    );
    assert.equal(
      computeStopReason({ ...none, loopGuardStop: true, toolHaltStop: true }),
      "guard"
    );
    assert.equal(
      computeStopReason({ ...none, budgetStop: true, maxTurnsStop: true }),
      "budget"
    );
  });

  it('terminal status: only natural/hook persist as "completed" (honest cutoff)', () => {
    assert.equal(terminalStatus("natural"), "completed");
    assert.equal(terminalStatus("hook"), "completed");
    for (const r of ["aborted", "guard", "approval", "policy", "budget", "maxTurns"]) {
      assert.equal(terminalStatus(r), r, `${r} must never masquerade as completed`);
    }
  });
});

// W2 stage 3 — final-answer rescue plan.
import { planFinalAnswerRescue } from "../src/agent/loop-stages.mjs";

describe("loop stage: final-answer rescue plan", () => {
  it("enabled by default; agent.finalAnswerRescue:false disables", () => {
    assert.equal(planFinalAnswerRescue({ cfg: {}, totalTurnCap: 90 }).enabled, true);
    assert.equal(
      planFinalAnswerRescue({ cfg: { agent: { finalAnswerRescue: false } }, totalTurnCap: 90 }).enabled,
      false
    );
  });

  it("default message demands a final answer; rescuePrompt overrides it (segments)", () => {
    const d = planFinalAnswerRescue({ cfg: {}, totalTurnCap: 90 });
    assert.equal(d.userMessage.role, "user");
    assert.match(d.userMessage.content, /Turn budget exhausted/);
    assert.match(d.userMessage.content, /remains unverified/);
    const seg = planFinalAnswerRescue({
      cfg: {},
      rescuePrompt: "Emit the xclaw-objective-state block.",
      totalTurnCap: 90,
    });
    assert.equal(seg.userMessage.content, "Emit the xclaw-objective-state block.");
  });

  it("rescued text is stamped best-effort with the cap; stub names the cap", () => {
    const p = planFinalAnswerRescue({ cfg: {}, totalTurnCap: 45 });
    assert.equal(
      p.formatRescuedText("The answer is 42."),
      "The answer is 42.\n\n_[stopped at turn cap 45; this is a best-effort final answer]_"
    );
    assert.equal(p.stubText, "Stopped after 45 turns (turn cap).");
  });
});

// W2 stage 4a — tool-call intake.
import { parseToolCallArgs } from "../src/agent/loop-stages.mjs";

describe("loop stage: tool-call intake", () => {
  it("parses args; malformed JSON degrades to {}", () => {
    assert.deepEqual(
      parseToolCallArgs({ function: { arguments: '{"a":1}' } }, null),
      { a: 1 }
    );
    assert.deepEqual(parseToolCallArgs({ function: { arguments: "not json" } }, null), {});
    assert.deepEqual(parseToolCallArgs({ function: {} }, null), {});
  });
  it("pins cwd to workingDir only when the model gave neither cwd nor workingDir", () => {
    assert.deepEqual(parseToolCallArgs({ function: { arguments: "{}" } }, "/w"), { cwd: "/w" });
    assert.deepEqual(
      parseToolCallArgs({ function: { arguments: '{"cwd":"/m"}' } }, "/w"),
      { cwd: "/m" }
    );
    assert.deepEqual(
      parseToolCallArgs({ function: { arguments: '{"workingDir":"/m"}' } }, "/w"),
      { workingDir: "/m" }
    );
    assert.deepEqual(parseToolCallArgs({ function: { arguments: "{}" } }, null), {});
  });
});

// W2 stage 4b — run-scoped allowlist verdict.
import { evaluateRunAllowlist } from "../src/agent/loop-stages.mjs";

describe("loop stage: run allowlist verdict", () => {
  it("no filter or a matching name → allowed (null)", () => {
    assert.equal(evaluateRunAllowlist("xclaw_bash", null), null);
    assert.equal(evaluateRunAllowlist("xclaw_bash", { match: () => true }), null);
  });
  it("non-matching name → deny plan with message/event/trace policy", () => {
    const b = evaluateRunAllowlist("made_up_tool", { match: () => false });
    assert.equal(b.message, "Tool made_up_tool is not available in this run (allowTools).");
    assert.deepEqual(b.event, { type: "tool", phase: "blocked", name: "made_up_tool", reason: "allowTools" });
    assert.deepEqual(b.policy, { phase: "filter", decision: "deny", reason: "allowTools" });
  });
});

// W2 stage 4c — TOCTOU plan re-validation.
import { planToctouRevalidation } from "../src/agent/loop-stages.mjs";

describe("loop stage: TOCTOU plan re-validation", () => {
  const basec = { name: "xclaw_bash", plan: { fingerprint: "fp1" }, planFingerprint: null, isExec: true, bindEnabled: true };

  it("not applicable without a plan, on non-exec tools, or when binding is off", () => {
    assert.equal(planToctouRevalidation({ ...basec, plan: null, revalidate: () => ({ ok: true }) }), null);
    assert.equal(planToctouRevalidation({ ...basec, isExec: false, revalidate: () => ({ ok: true }) }), null);
    assert.equal(planToctouRevalidation({ ...basec, bindEnabled: false, revalidate: () => ({ ok: true }) }), null);
  });

  it("passing re-validation emits plan_revalidated with the fingerprint", () => {
    const r = planToctouRevalidation({ ...basec, revalidate: () => ({ ok: true }) });
    assert.equal(r.ok, true);
    assert.deepEqual(r.event, { type: "security", phase: "plan_revalidated", name: "xclaw_bash", planFingerprint: "fp1" });
  });

  it("explicit planFingerprint wins over the plan's own", () => {
    const r = planToctouRevalidation({ ...basec, planFingerprint: "fp-auth", revalidate: () => ({ ok: true }) });
    assert.equal(r.event.planFingerprint, "fp-auth");
  });

  it("drift denies with message, event, typed policy input, and guard note", () => {
    const r = planToctouRevalidation({
      ...basec,
      revalidate: () => ({ ok: false, reason: "command_mismatch", drift: { was: "a", now: "b" } }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.message, "Plan revalidation failed (command_mismatch).");
    assert.equal(r.event.phase, "plan_revalidate_failed");
    assert.deepEqual(r.event.drift, { was: "a", now: "b" });
    assert.deepEqual(r.policyInput, { phase: "plan_revalidate", decision: "deny", reason: "command_mismatch", tool: "xclaw_bash" });
    assert.equal(r.guardNote, "DENIED: command_mismatch");
  });

  it("reason-less drift falls back to plan_drift; custom message wins", () => {
    const r = planToctouRevalidation({ ...basec, revalidate: () => ({ ok: false, message: "custom" }) });
    assert.equal(r.message, "custom");
    assert.equal(r.policyInput.reason, "plan_drift");
    assert.equal(r.guardNote, "DENIED: plan_drift");
  });
});

// W2 stage 4d — approval-outcome plan.
import { planApprovalOutcome } from "../src/agent/loop-stages.mjs";

describe("loop stage: approval-outcome plan", () => {
  const fbr = (i) => `BLOCKED ${i.tool} (${i.reason}) pending=${i.pendingId}`;
  const inp = { name: "xclaw_bash", args: { command: "rm x" }, formatBlockedReply: fbr };

  it("auto-approved proceeds silently; human approval proceeds with the approved event", () => {
    assert.deepEqual(planApprovalOutcome({ ok: true, mode: "auto" }, inp), { action: "proceed", event: null });
    const h = planApprovalOutcome({ ok: true, mode: "human", note: "frank", plan: { fingerprint: "f" } }, inp);
    assert.equal(h.action, "proceed");
    assert.equal(h.event.phase, "approved");
    assert.equal(h.event.planFingerprint, "f");
  });

  it("pending stops the turn: record, user-visible reply, restate event, pending policy", () => {
    const r = planApprovalOutcome({ ok: false, reason: "pending", pendingId: "p1" }, inp);
    assert.equal(r.action, "stop");
    assert.deepEqual(r.pendingRecord, { id: "p1", tool: "xclaw_bash", args: inp.args, reason: "pending" });
    assert.equal(r.message, 'BLOCKED xclaw_bash (pending) pending=p1');
    assert.equal(r.event.phase, "approval_required");
    assert.equal(r.event.restate, true);
    assert.equal(r.event.timedOut, false);
    assert.equal(r.policyInput.decision, "pending");
    assert.equal(r.guardNote, null);
  });

  it("timeout counts as pending and marks timedOut; auth.id is a pendingId fallback", () => {
    const r = planApprovalOutcome({ ok: false, reason: "timeout", id: "p9" }, inp);
    assert.equal(r.action, "stop");
    assert.equal(r.pendingId, "p9");
    assert.equal(r.event.timedOut, true);
  });

  // The whole timeout family means the window closed with nobody answering.
  // Only the 120s fallback was named, so the two SLA expiries were classified
  // by the pendingId fallback rather than by what they mean.
  for (const reason of ["sla_timeout", "sla_timeout_critical"]) {
    it(`${reason} is an unanswered ask, not a verdict`, () => {
      const r = planApprovalOutcome({ ok: false, reason, pendingId: "p8" }, inp);
      assert.equal(r.action, "stop");
      assert.equal(r.event.phase, "approval_required");
      assert.equal(r.event.timedOut, true);
      assert.equal(r.guardNote, null);
    });
  }

  // A gate that hands back an id and nothing else is asking for a human.
  it("a bare pendingId with no reason is still pending", () => {
    const r = planApprovalOutcome({ ok: false, pendingId: "p7" }, inp);
    assert.equal(r.action, "stop");
    assert.equal(r.event.phase, "approval_required");
  });

  it("hard denial continues the turn with a guard note and deny policy", () => {
    const r = planApprovalOutcome({ ok: false, reason: "allowlist" }, inp);
    assert.equal(r.action, "deny");
    assert.equal(r.message, "Tool xclaw_bash blocked (allowlist).");
    assert.equal(r.event.phase, "denied");
    assert.equal(r.policyInput.decision, "deny");
    assert.equal(r.guardNote, "DENIED: Tool xclaw_bash blocked (allowlist).");
  });

  // REGRESSION: every deny case here used to be hand-built WITHOUT a
  // pendingId — a shape the real gate never produces for a human path, since
  // authorize returns `{...decision, pendingId: id}` on every answer. So these
  // tests passed while production classified an operator's Deny as pending.
  it("an operator's deny is a verdict even though it carries a pendingId", () => {
    const r = planApprovalOutcome(
      { ok: false, reason: "denied", message: "Denied by operator.", pendingId: "p3" },
      inp
    );
    assert.equal(r.action, "deny", "the turn continues; the model must try something else");
    assert.equal(r.event.phase, "denied", "telegram/webchat render denials off this phase");
    assert.equal(r.message, "Denied by operator.", "the operator's words, not 'awaiting approval'");
    assert.equal(r.pendingRecord, null, "a decided ask must not be resurrected as pending");
    assert.equal(r.policyInput.decision, "deny");
    assert.equal(r.guardNote, "DENIED: Denied by operator.", "repeated denied retries feed the guard");
  });

  // revalidateOnDecide (default on) resolves the pending with the drift
  // reason: a terminal security verdict that was also being read as pending.
  it("decide-time drift is a verdict, not a pending ask", () => {
    const r = planApprovalOutcome(
      { ok: false, reason: "plan_drift", message: "Environment drifted (TOCTOU).", pendingId: "p4" },
      inp
    );
    assert.equal(r.action, "deny");
    assert.equal(r.event.phase, "denied");
    assert.equal(r.event.reason, "plan_drift");
    assert.equal(r.guardNote, "DENIED: Environment drifted (TOCTOU).");
  });

  it("denial message from the gate wins; args preview is capped at 180", () => {
    const r = planApprovalOutcome({ ok: false, reason: "denied", message: "custom deny" }, inp);
    assert.equal(r.message, "custom deny");
    const big = { name: "t", args: { x: "y".repeat(500) }, formatBlockedReply: (i) => i.argsPreview };
    const p = planApprovalOutcome({ ok: false, reason: "pending", pendingId: "p" }, big);
    assert.equal(p.message.length, 180);
  });
});
