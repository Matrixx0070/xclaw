import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSpawnTools,
  maxChildrenPerRun,
  childTurns,
} from "../src/tools/spawn-tools.mjs";
import { inferPlane } from "../src/tools/planes.mjs";

describe("xclaw_spawn_agent", () => {
  it("is exposed with a task parameter", () => {
    const [tool] = createSpawnTools({ cfg: {} });
    assert.equal(tool.name, "xclaw_spawn_agent");
    assert.deepEqual(tool.parameters.required, ["task"]);
    assert.equal(tool.isReadOnly(), false);
  });

  it("routes to the local plane", () => {
    // inferPlane's /spawn|subagent/ rule sent it to the "agent" plane, which has
    // no handler — every call failed in ~1ms and the model silently fell back to
    // sequential shell commands while claiming it had run them in parallel
    assert.equal(inferPlane("xclaw_spawn_agent"), "local");
  });

  it("refuses an empty task instead of spawning", async () => {
    const [tool] = createSpawnTools({ cfg: {} });
    const out = await tool.execute({ task: "   " });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /task is required/);
  });

  it("caps fan-out per run", async () => {
    const state = { spawned: 2 };
    const [tool] = createSpawnTools({ cfg: { swarm: { maxChildrenPerRun: 2 } }, runState: state });
    const out = await tool.execute({ task: "anything" });
    assert.equal(out.isError, true);
    assert.equal(out.code, "SPAWN_FANOUT_EXCEEDED");
    assert.match(out.content[0].text, /spawn limit reached/);
    assert.equal(state.spawned, 2, "a refused call must not consume budget");
  });

  it("reads the fan-out limit from config with a sane default", () => {
    assert.equal(maxChildrenPerRun({}), 4);
    assert.equal(maxChildrenPerRun({ swarm: { maxChildrenPerRun: 9 } }), 9);
    for (const bad of [0, -3, "x", null]) {
      assert.equal(maxChildrenPerRun({ swarm: { maxChildrenPerRun: bad } }), 4, String(bad));
    }
  });

  it("clamps a child's turn budget", () => {
    const cfg = { swarm: { maxChildTurns: 5 } };
    assert.equal(childTurns(99, cfg), 5, "cannot exceed the ceiling");
    assert.equal(childTurns(3, cfg), 3);
    assert.equal(childTurns(undefined, cfg), 5, "default is clamped too");
    assert.equal(childTurns(-1, cfg), 5);
    assert.equal(childTurns(2, {}), 2);
  });
});
