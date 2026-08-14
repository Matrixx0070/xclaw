import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  runObjective,
  parseStateBlock,
  stripStateBlocks,
  buildSegmentPrompt,
  STATE_FENCE,
} from "../src/agent/objective.mjs";
import {
  newObjective,
  saveObjective,
  loadObjective,
  mergeStateUpdate,
  reconcileInterruptedObjectives,
  findActiveObjective,
} from "../src/agent/objective-store.mjs";

async function cfgTmp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-obj-"));
  return { paths: { configDir: dir }, objectives: { progressEverySegments: 0 }, _dir: dir };
}

function block(state) {
  return "```" + STATE_FENCE + "\n" + JSON.stringify(state) + "\n```";
}

function fakeTrace(n) {
  return Array.from({ length: n }, (_, i) => ({ name: "xclaw_file_read", i }));
}

const OBJECTIVE_TEXT = "Read, analyze, and fully understand the entire DEMO project.";

describe("objective state store", () => {
  it("merge: objective never overwritten, criteria done sticky, arrays capped", async () => {
    const obj = newObjective({ objective: OBJECTIVE_TEXT });
    mergeStateUpdate(obj, {
      objective: "EVIL REPLACEMENT",
      criteria: [{ id: "c1", text: "structure understood", done: false }],
      inspected: { files: ["a.js"] },
    });
    assert.equal(obj.objective, OBJECTIVE_TEXT);
    mergeStateUpdate(obj, { criteria: [{ id: "c1", text: "structure understood", done: true, evidence: "read it" }] });
    mergeStateUpdate(obj, { criteria: [{ id: "c1", text: "structure understood", done: false }] });
    assert.equal(obj.criteria[0].done, true, "done is sticky");
    mergeStateUpdate(obj, { inspected: { files: Array.from({ length: 600 }, (_, i) => `f${i}.js`) } });
    assert.ok(obj.inspected.files.length <= 400, "capped");
  });

  it("save/load/reconcile/findActive round trip", async () => {
    const cfg = await cfgTmp();
    const obj = newObjective({ objective: "x", channel: "telegram", chatId: "42" });
    await saveObjective(cfg, obj);
    const loaded = await loadObjective(cfg, obj.id);
    assert.equal(loaded.objective, "x");
    const found = await findActiveObjective(cfg, { channel: "telegram", chatId: "42" });
    assert.equal(found.id, obj.id);
    const ids = await reconcileInterruptedObjectives(cfg);
    assert.deepEqual(ids, [obj.id]);
    assert.equal((await loadObjective(cfg, obj.id)).status, "interrupted");
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("parse/strip state blocks (last-wins, tolerant)", () => {
    const text = `prose\n${block({ status: "continue" })}\nmore\n${block({ status: "done" })}`;
    assert.equal(parseStateBlock(text).status, "done");
    assert.ok(!stripStateBlocks(text).includes(STATE_FENCE));
    assert.equal(parseStateBlock("no block"), null);
    assert.equal(parseStateBlock("```" + STATE_FENCE + "\nnot json```"), null);
  });
});

describe("long-run orchestrator — the 20-30-tool-call failure, reproduced and fixed", () => {
  it("a 72-tool-call mission runs 6 segments to criteria completion without EVER asking the user", async () => {
    const cfg = await cfgTmp();
    const prompts = [];
    const notifications = [];
    let seg = 0;
    const criteria = [
      { id: "c1", text: "structure understood" },
      { id: "c2", text: "entry points identified" },
      { id: "c3", text: "data flows understood" },
    ];
    const runSegment = async ({ prompt, rescuePrompt }) => {
      prompts.push(prompt);
      assert.ok(rescuePrompt.includes(STATE_FENCE), "segment rescue asks for state block");
      seg += 1;
      const isLast = seg === 6;
      const state = {
        status: isLast ? "done" : "continue",
        interpretation: "deep-read of DEMO",
        criteria: criteria.map((c, i) => ({ ...c, done: isLast || i < seg / 2 })),
        plan: ["read structure", "trace flows"],
        currentSubtask: `phase ${seg}`,
        progress: [`segment ${seg} read 12 files`],
        findings: [`finding from segment ${seg}`],
        inspected: { files: Array.from({ length: 12 }, (_, i) => `src/s${seg}-f${i}.js`) },
      };
      return {
        // every non-final segment is CUT OFF by the turn cap — the exact
        // live failure shape — and the mission must keep going anyway
        text: `worked on phase ${seg}\n${block(state)}`,
        turns: 12,
        toolTrace: fakeTrace(12),
        stopReason: isLast ? "natural" : "maxTurns",
      };
    };
    const out = await runObjective(cfg, {
      objective: OBJECTIVE_TEXT,
      runSegment,
      notify: async (t, meta) => notifications.push({ t, kind: meta?.kind }),
    });

    assert.equal(out.status, "done");
    assert.equal(out.objective.totals.segments, 6);
    assert.equal(out.objective.totals.toolCalls, 72, "well past the 20-30 wall");
    // the ORIGINAL objective is present verbatim in EVERY segment prompt
    for (const p of prompts) assert.ok(p.includes(OBJECTIVE_TEXT), "objective never lost");
    // progress carries: segment 4's prompt knows files inspected in segment 1
    assert.ok(prompts[3].includes("src/s1-f0.js"), "no rediscovery — inspected files carried");
    assert.ok(prompts[3].includes("finding from segment 2"), "findings carried");
    // the runtime never asked the user anything mid-mission
    const asks = notifications.filter((n) => n.kind === "escalated");
    assert.equal(asks.length, 0, "no routine approval questions");
    assert.equal(notifications.at(-1).kind, "done");
    assert.ok(notifications.at(-1).t.includes("72 tool calls"));
    // every segment prompt tells the model the turn cap is not completion
    for (const p of prompts) assert.ok(p.includes("execution constraint"), "contract present");
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("needs_human escalates ONCE with the question; owner's answer resumes and completes", async () => {
    const cfg = await cfgTmp();
    const notifications = [];
    let calls = 0;
    const runSegment = async ({ prompt }) => {
      calls += 1;
      if (calls === 1) {
        return {
          text: block({ status: "needs_human", humanQuestion: "Which environment: staging or prod?" }),
          turns: 3,
          toolTrace: fakeTrace(3),
          stopReason: "natural",
        };
      }
      // resumed segment must carry the owner's answer
      assert.ok(prompt.includes("staging"), "answer injected into resume segment");
      return {
        text: block({ status: "done", criteria: [{ id: "c1", text: "t", done: true }] }),
        turns: 2,
        toolTrace: fakeTrace(2),
        stopReason: "natural",
      };
    };
    const first = await runObjective(cfg, {
      objective: "deploy something",
      runSegment,
      notify: async (t, m) => notifications.push({ t, kind: m?.kind }),
    });
    assert.equal(first.status, "awaiting_human");
    assert.ok(notifications.some((n) => n.kind === "escalated" && n.t.includes("staging or prod")));

    const resumed = await runObjective(cfg, {
      resumeId: first.id,
      answer: "staging",
      runSegment,
      notify: async (t, m) => notifications.push({ t, kind: m?.kind }),
    });
    assert.equal(resumed.status, "done");
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("needs_human WITHOUT a concrete question is pushed back, not escalated", async () => {
    const cfg = await cfgTmp();
    let calls = 0;
    const runSegment = async ({ prompt }) => {
      calls += 1;
      if (calls === 1) return { text: block({ status: "needs_human" }), turns: 1, toolTrace: [], stopReason: "natural" };
      assert.ok(prompt.includes("decide yourself and continue"));
      return { text: block({ status: "done" }), turns: 1, toolTrace: [], stopReason: "natural" };
    };
    const out = await runObjective(cfg, { objective: "x", runSegment });
    assert.equal(out.status, "done");
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("done with unsatisfied criteria gets bounded anti-drift pushback", async () => {
    const cfg = await cfgTmp();
    let calls = 0;
    const runSegment = async ({ prompt }) => {
      calls += 1;
      if (calls === 1) {
        return {
          text: block({ status: "done", criteria: [{ id: "c1", text: "dependencies mapped", done: false }] }),
          turns: 1, toolTrace: [], stopReason: "natural",
        };
      }
      assert.ok(prompt.includes("dependencies mapped"), "pushback names the open criterion");
      return {
        text: block({ status: "done", criteria: [{ id: "c1", text: "dependencies mapped", done: true, evidence: "mapped" }] }),
        turns: 1, toolTrace: [], stopReason: "natural",
      };
    };
    const out = await runObjective(cfg, { objective: "x", runSegment });
    assert.equal(out.status, "done");
    assert.equal(calls, 2);
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("blocked gets one recovery directive, then escalates", async () => {
    const cfg = await cfgTmp();
    const notes = [];
    let calls = 0;
    const runSegment = async ({ prompt }) => {
      calls += 1;
      if (calls === 2) assert.ok(prompt.includes("attempt a reasonable recovery"));
      return { text: block({ status: "blocked", blockedReason: "disk on fire" }), turns: 1, toolTrace: [], stopReason: "natural" };
    };
    const out = await runObjective(cfg, {
      objective: "x", runSegment,
      notify: async (t, m) => notes.push({ t, kind: m?.kind }),
    });
    assert.equal(out.status, "awaiting_human");
    assert.equal(calls, 2, "exactly one recovery attempt");
    assert.ok(notes.some((n) => n.t.includes("disk on fire")));
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("missing state block: one reminder, then fail toward the user with the model's text", async () => {
    const cfg = await cfgTmp();
    const notes = [];
    let calls = 0;
    const runSegment = async ({ prompt }) => {
      calls += 1;
      if (calls === 2) assert.ok(prompt.includes("did not end with a parseable"));
      return { text: "Should I continue with this approach?", turns: 15, toolTrace: fakeTrace(25), stopReason: "maxTurns" };
    };
    const out = await runObjective(cfg, {
      objective: "x", runSegment,
      notify: async (t, m) => notes.push({ t, kind: m?.kind }),
    });
    assert.equal(out.status, "awaiting_human");
    assert.equal(calls, 2);
    assert.ok(notes.at(-1).t.includes("Should I continue with this approach?"), "model text surfaced, not swallowed");
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("segment budget pauses resumable — never a silent death; resume continues with same state", async () => {
    const cfg = await cfgTmp();
    cfg.objectives.maxSegments = 3;
    const notes = [];
    let calls = 0;
    const runSegment = async ({ prompt }) => {
      calls += 1;
      if (calls > 3) {
        // resumed run: prior progress must still be there
        assert.ok(prompt.includes("segment 2 progress"), "state survived the pause");
        return { text: block({ status: "done" }), turns: 1, toolTrace: [], stopReason: "natural" };
      }
      return {
        text: block({ status: "continue", progress: [`segment ${calls} progress`] }),
        turns: 12, toolTrace: fakeTrace(12), stopReason: "maxTurns",
      };
    };
    const paused = await runObjective(cfg, {
      objective: "x", runSegment,
      notify: async (t, m) => notes.push({ t, kind: m?.kind }),
    });
    assert.equal(paused.status, "paused_budget");
    assert.ok(notes.some((n) => n.kind === "paused"));
    cfg.objectives.maxSegments = 10;
    const resumed = await runObjective(cfg, { resumeId: paused.id, runSegment });
    assert.equal(resumed.status, "done");
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("stop request halts at the segment boundary with state preserved", async () => {
    const cfg = await cfgTmp();
    let calls = 0;
    const runSegment = async () => {
      calls += 1;
      const obj = (await import("../src/agent/objective-store.mjs")).loadObjective;
      // request stop mid-mission (as /objective stop would)
      const o = await obj(cfg, id);
      o.stopRequested = true;
      await saveObjective(cfg, o);
      return { text: block({ status: "continue", progress: ["p1"] }), turns: 5, toolTrace: fakeTrace(5), stopReason: "maxTurns" };
    };
    let id;
    const out = await runObjective(cfg, {
      objective: "x",
      runSegment: async (a) => {
        id = a.objectiveId;
        return runSegment(a);
      },
    });
    assert.equal(out.status, "stopped");
    assert.equal(calls, 1);
    const saved = await loadObjective(cfg, out.id);
    assert.deepEqual(saved.progress, ["p1"], "state preserved through stop");
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("interrupted objective resumes with a reconcile directive", async () => {
    const cfg = await cfgTmp();
    const obj = newObjective({ objective: "long thing" });
    mergeStateUpdate(obj, { progress: ["earlier work"], criteria: [{ id: "c1", text: "t", done: false }] });
    obj.status = "interrupted"; // as boot reconcile would leave it
    await saveObjective(cfg, obj);
    const out = await runObjective(cfg, {
      resumeId: obj.id,
      runSegment: async ({ prompt }) => {
        assert.ok(prompt.includes("runtime restarted"), "reconcile notice present");
        assert.ok(prompt.includes("earlier work"), "prior progress present");
        return { text: block({ status: "done", criteria: [{ id: "c1", text: "t", done: true }] }), turns: 1, toolTrace: [], stopReason: "natural" };
      },
    });
    assert.equal(out.status, "done");
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("segment crash retries once, then pauses interrupted (resumable)", async () => {
    const cfg = await cfgTmp();
    let calls = 0;
    const out = await runObjective(cfg, {
      objective: "x",
      runSegment: async () => {
        calls += 1;
        throw new Error("provider melted");
      },
      notify: async () => {},
    });
    assert.equal(calls, 2);
    assert.equal(out.status, "interrupted");
    const saved = await loadObjective(cfg, out.id);
    assert.ok(saved.failures.length >= 2);
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("buildSegmentPrompt: first segment derives criteria; later segments carry full state", () => {
    const obj = newObjective({ objective: OBJECTIVE_TEXT });
    const p1 = buildSegmentPrompt(obj, { firstSegment: true });
    assert.ok(p1.includes("Derive an interpretation"));
    mergeStateUpdate(obj, {
      criteria: [{ id: "c1", text: "structure understood", done: true }],
      decisions: ["use module map"],
      failures: [{ what: "grep crashed", error: "boom" }],
      inspected: { files: ["src/a.js"] },
    });
    const p2 = buildSegmentPrompt(obj, {});
    for (const frag of ["[x] c1: structure understood", "use module map", "grep crashed", "src/a.js", OBJECTIVE_TEXT]) {
      assert.ok(p2.includes(frag), `missing: ${frag}`);
    }
  });
});
