import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  runObjective,
  buildSegmentPrompt,
  checkObjectiveGuardrails,
  STATE_FENCE,
} from "../src/agent/objective.mjs";
import { newObjective, mergeStateUpdate } from "../src/agent/objective-store.mjs";
import { parseObjectiveFlags } from "../src/channels/runtime.mjs";

async function cfgTmp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-grd-"));
  return {
    paths: { configDir: dir },
    objectives: { progressEverySegments: 0, requireChecked: false, deriveChecks: false },
    _dir: dir,
  };
}

function block(state) {
  return "```" + STATE_FENCE + "\n" + JSON.stringify(state) + "\n```";
}
function fakeTrace(n) {
  return Array.from({ length: n }, (_, i) => ({ name: "xclaw_file_read", i }));
}

describe("objective guardrails — durable state additions", () => {
  it("assumptions merge (bounded union) and surface in the segment prompt", () => {
    const obj = newObjective({ objective: "do the thing" });
    assert.deepEqual(obj.assumptions, []);
    mergeStateUpdate(obj, { assumptions: ["staging, not prod", "node 20 runtime"] });
    mergeStateUpdate(obj, { assumptions: ["staging, not prod", "postgres 15"] });
    assert.deepEqual(
      obj.assumptions,
      ["staging, not prod", "node 20 runtime", "postgres 15"],
      "union dedupes, keeps order"
    );
    // give it some criteria so buildSegmentPrompt runs the non-first branch
    obj.criteria = [{ id: "c1", text: "t", done: false }];
    obj.plan = ["a", "b"];
    const prompt = buildSegmentPrompt(obj, {});
    assert.ok(prompt.includes("Working assumptions"), "assumptions section present");
    assert.ok(prompt.includes("postgres 15"), "assumption carried into prompt");
  });

  it("planVersion is an audit trail: bumps on change, no-op on identical replan", () => {
    const obj = newObjective({ objective: "x" });
    assert.equal(obj.planVersion, 0, "no plan yet -> v0");
    mergeStateUpdate(obj, { plan: ["read code", "write tests"] });
    assert.equal(obj.planVersion, 1, "first plan -> v1");
    mergeStateUpdate(obj, { plan: ["read code", "write tests"] });
    assert.equal(obj.planVersion, 1, "identical replan does not bump");
    mergeStateUpdate(obj, { plan: ["read code", "write tests", "ship"] });
    assert.equal(obj.planVersion, 2, "changed plan bumps");
    const prompt = buildSegmentPrompt(
      { ...obj, criteria: [{ id: "c1", text: "t", done: false }] },
      {}
    );
    assert.ok(prompt.includes("## Plan (v2)"), "plan version shown in prompt header");
  });

  it("checkObjectiveGuardrails is a pure typed predicate", () => {
    assert.equal(checkObjectiveGuardrails(newObjective({ objective: "x" })), null, "no limits -> null");
    const past = newObjective({ objective: "x", deadline: "2000-01-01T00:00:00.000Z" });
    assert.equal(checkObjectiveGuardrails(past)?.reason, "deadline");
    const future = newObjective({ objective: "x", deadline: "2999-01-01T00:00:00.000Z" });
    assert.equal(checkObjectiveGuardrails(future), null, "future deadline is fine");
    const tc = newObjective({ objective: "x", budget: { maxToolCalls: 5 } });
    tc.totals.toolCalls = 5;
    assert.equal(checkObjectiveGuardrails(tc)?.reason, "maxToolCalls");
    const usd = newObjective({ objective: "x", budget: { maxUsd: 0.01 } });
    usd.totals.costUsd = 0.02;
    assert.equal(checkObjectiveGuardrails(usd)?.reason, "maxUsd");
  });
});

describe("operator flag parsing (/objective ... --deadline --max-usd --max-tools)", () => {
  it("strips flags and returns the goal text with normalized limits", () => {
    const r = parseObjectiveFlags("audit the repo --deadline +2h --max-usd 5 --max-tools 30");
    assert.equal(r.text, "audit the repo");
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(r.deadline), "relative deadline -> ISO");
    assert.deepEqual(r.budget, { maxUsd: 5, maxToolCalls: 30 });
  });
  it("no flags -> plain text, null limits", () => {
    const r = parseObjectiveFlags("just do it");
    assert.equal(r.text, "just do it");
    assert.equal(r.deadline, null);
    assert.equal(r.budget, null);
  });
  it("ISO deadline passes through; partial budget keeps the other null", () => {
    const r = parseObjectiveFlags("x --deadline 2030-01-01T00:00:00Z --max-tools 12");
    assert.equal(r.deadline, "2030-01-01T00:00:00Z");
    assert.deepEqual(r.budget, { maxUsd: null, maxToolCalls: 12 });
  });
});

describe("objective guardrails — orchestrator pauses between segments", () => {
  it("a past deadline pauses BEFORE any segment runs (model cannot outrun the clock)", async () => {
    const cfg = await cfgTmp();
    let calls = 0;
    const notifications = [];
    const runSegment = async () => {
      calls += 1;
      return { text: block({ status: "continue" }), turns: 1, toolTrace: fakeTrace(1), stopReason: "natural" };
    };
    const out = await runObjective(cfg, {
      objective: "long thing",
      deadline: "2000-01-01T00:00:00.000Z",
      runSegment,
      notify: async (t, m) => notifications.push({ t, kind: m?.kind }),
    });
    assert.equal(out.status, "paused_budget");
    assert.equal(calls, 0, "no segment ran past the deadline");
    assert.ok(notifications.some((n) => n.kind === "paused" && /deadline/.test(n.t)));
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("a tool-call budget pauses AFTER the segment that crosses it", async () => {
    const cfg = await cfgTmp();
    let calls = 0;
    const runSegment = async () => {
      calls += 1;
      return { text: block({ status: "continue" }), turns: 12, toolTrace: fakeTrace(12), stopReason: "maxTurns" };
    };
    const out = await runObjective(cfg, {
      objective: "long thing",
      budget: { maxToolCalls: 10 },
      runSegment,
      notify: async () => {},
    });
    assert.equal(out.status, "paused_budget");
    assert.equal(calls, 1, "ran one segment (12 calls), then paused before the next");
    assert.equal(out.objective.totals.toolCalls, 12);
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("a spend budget pauses on accumulated real cost", async () => {
    const cfg = await cfgTmp();
    let calls = 0;
    const runSegment = async () => {
      calls += 1;
      return {
        text: block({ status: "continue" }),
        turns: 3,
        toolTrace: fakeTrace(3),
        stopReason: "maxTurns",
        usage: { hasCost: true, costUsd: 0.02 },
        model: "test-model",
      };
    };
    const out = await runObjective(cfg, {
      objective: "expensive thing",
      budget: { maxUsd: 0.01 },
      runSegment,
      notify: async () => {},
    });
    assert.equal(out.status, "paused_budget");
    assert.equal(calls, 1, "one segment spent $0.02 >= $0.01 cap");
    assert.ok(Math.abs(out.objective.totals.costUsd - 0.02) < 1e-9, "cost accumulated");
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("resume with a raised budget continues past the pause to completion", async () => {
    const cfg = await cfgTmp();
    let calls = 0;
    const runSegment = async () => {
      calls += 1;
      const done = calls >= 2;
      return {
        text: block({ status: done ? "done" : "continue", criteria: [{ id: "c1", text: "t", done }] }),
        turns: 4,
        toolTrace: fakeTrace(4),
        stopReason: "natural",
      };
    };
    const first = await runObjective(cfg, {
      objective: "two-phase thing",
      budget: { maxToolCalls: 4 },
      runSegment,
      notify: async () => {},
    });
    assert.equal(first.status, "paused_budget", "paused after segment 1 hit the 4-call cap");
    assert.equal(calls, 1);
    const resumed = await runObjective(cfg, {
      resumeId: first.id,
      budget: { maxToolCalls: 20 },
      runSegment,
      notify: async () => {},
    });
    assert.equal(resumed.status, "done", "raised cap let it finish");
    assert.equal(resumed.objective.budget.maxToolCalls, 20, "operator raised the ceiling");
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });
});
