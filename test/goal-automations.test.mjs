import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  GOAL_STATE_MARKER,
  buildGoalPrompt,
  parseGoalState,
  applyGoalTick,
  initialGoalState,
} from "../src/automations/goal.mjs";
import {
  createAutomation,
  executeAutomation,
  getAutomation,
} from "../src/automations/index.mjs";

const stateBlock = (obj) =>
  "```json " + GOAL_STATE_MARKER + "\n" + JSON.stringify(obj) + "\n```";

describe("goal-mode automations", () => {
  describe("goal core", () => {
    it("prompt includes goal, tick, plan, notes, marker", () => {
      const p = buildGoalPrompt({
        goal: "Learn everything about widgets",
        maxTicks: 5,
        state: { tick: 2, plan: "step A then B", progress: ["found docs"], done: false },
      });
      assert.match(p, /tick 3 of at most 5/);
      assert.match(p, /GOAL: Learn everything about widgets/);
      assert.match(p, /step A then B/);
      assert.match(p, /- found docs/);
      assert.ok(p.includes(GOAL_STATE_MARKER));
    });

    it("parses a marker-tagged state block (last one wins)", () => {
      const text =
        "did things\n" +
        stateBlock({ plan: "old", progressNote: "x", done: false }) +
        "\nmore\n" +
        stateBlock({ plan: "new plan", progressNote: "finished step", done: true });
      const r = parseGoalState(text);
      assert.equal(r.ok, true);
      assert.equal(r.state.plan, "new plan");
      assert.equal(r.state.done, true);
    });

    it("falls back to untagged json block with expected keys", () => {
      const text = "```json\n{\"plan\": \"p\", \"progressNote\": \"n\", \"done\": false}\n```";
      const r = parseGoalState(text);
      assert.equal(r.ok, true);
      assert.equal(r.state.plan, "p");
    });

    it("rejects unrelated json and garbage", () => {
      assert.equal(parseGoalState("```json\n{\"foo\": 1}\n```").ok, false);
      assert.equal(parseGoalState("no blocks here").ok, false);
      assert.equal(parseGoalState("```json\nnot json\n```").ok, false);
    });

    it("applyGoalTick advances state and finishes on done", () => {
      const auto = { maxTicks: 10, state: initialGoalState() };
      const t1 = applyGoalTick(auto, {
        ok: true,
        state: { plan: "P1", progressNote: "n1", done: false },
      });
      assert.equal(t1.state.tick, 1);
      assert.equal(t1.finished, false);
      auto.state = t1.state;
      const t2 = applyGoalTick(auto, {
        ok: true,
        state: { plan: "P2", progressNote: "n2", done: true },
      });
      assert.equal(t2.finished, true);
      assert.equal(t2.reason, "done");
      assert.deepEqual(t2.state.progress, ["n1", "n2"]);
    });

    it("finishes with max_ticks when exhausted", () => {
      const auto = { maxTicks: 1, state: initialGoalState() };
      const t = applyGoalTick(auto, { ok: false });
      assert.equal(t.finished, true);
      assert.equal(t.reason, "max_ticks");
      assert.match(t.state.progress[0], /no parsable state/);
    });
  });

  describe("store integration", () => {
    let cfg;
    before(async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-goal-"));
      cfg = { paths: { automationsFile: path.join(dir, "automations.json") } };
    });
    after(async () => {
      if (cfg?.paths?.automationsFile) {
        await fs.rm(path.dirname(cfg.paths.automationsFile), {
          recursive: true,
          force: true,
        });
      }
    });

    it("createAutomation mode:goal shapes the record", () => {
      const r = createAutomation(cfg, {
        mode: "goal",
        goal: "Ship the report",
        everyMs: 3_600_000,
        enabled: false,
        maxTicks: 3,
      });
      assert.equal(r.ok, true);
      assert.equal(r.automation.mode, "goal");
      assert.equal(r.automation.goal, "Ship the report");
      assert.equal(r.automation.maxTicks, 3);
      assert.deepEqual(r.automation.state, initialGoalState());
    });

    it("executeAutomation ticks, persists state, and self-disables on done", async () => {
      const r = createAutomation(cfg, {
        mode: "goal",
        goal: "Two-step goal",
        everyMs: 3_600_000,
        enabled: false,
        maxTicks: 5,
      });
      const id = r.automation.id;
      const prompts = [];
      const replies = [
        "worked on it\n" +
          stateBlock({ plan: "next: finish", progressNote: "did step 1", done: false }),
        "all done\n" +
          stateBlock({ plan: "-", progressNote: "did step 2", done: true }),
      ];
      let call = 0;
      const runner = async ({ message }) => {
        prompts.push(message);
        return { ok: true, text: replies[call++] };
      };

      const t1 = await executeAutomation(cfg, id, { runner });
      assert.equal(t1.ok, true);
      assert.equal(t1.result.tick, 1);
      assert.equal(t1.result.goalFinished, false);
      let auto = getAutomation(cfg, id);
      assert.equal(auto.state.tick, 1);
      assert.deepEqual(auto.state.progress, ["did step 1"]);
      assert.match(prompts[0], /GOAL: Two-step goal/);

      const t2 = await executeAutomation(cfg, id, { runner });
      assert.equal(t2.result.goalFinished, true);
      assert.equal(t2.result.goalReason, "done");
      auto = getAutomation(cfg, id);
      assert.equal(auto.enabled, false, "self-disabled on done");
      assert.equal(auto.state.done, true);
      // tick 2 prompt carried tick-1 state forward
      assert.match(prompts[1], /did step 1/);
      assert.match(prompts[1], /next: finish/);
    });

    it("prompt-mode automations are untouched by goal wiring", async () => {
      const r = createAutomation(cfg, {
        prompt: "say hi",
        everyMs: 3_600_000,
        enabled: false,
      });
      assert.equal(r.automation.mode, "prompt");
      assert.equal(r.automation.state, undefined);
      const out = await executeAutomation(cfg, r.automation.id, {
        runner: async ({ message }) => {
          assert.equal(message, "say hi");
          return { ok: true, text: "hi" };
        },
      });
      assert.equal(out.ok, true);
      assert.equal(out.result.tick, undefined);
    });
  });
});
