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
