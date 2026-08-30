import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "path";
import os from "os";
import { runSwarmFanOut, createSwarmRunTool } from "../src/agents/swarm-run.mjs";
import { listSwarmRuns, getSwarmRun } from "../src/agents/swarm-store.mjs";

/** Deterministic mock — no real LLM / computer */
function mockSpawn({ failIds = new Set() } = {}) {
  let seq = 0;
  return async (opts) => {
    const id = `mock-child-${++seq}`;
    const m = String(opts.task || "").match(/Subtask \(([^)]+)\):/);
    const nodeId = m?.[1] || id;
    if (failIds.has(nodeId)) {
      return {
        ok: false,
        id,
        status: "error",
        error: "mock failure",
        result: null,
      };
    }
    return {
      ok: true,
      id,
      status: "done",
      result: {
        text: `ok:${nodeId}`,
        turns: 1,
        workspace: null,
      },
    };
  };
}

describe("S1 swarm fan-out", () => {
  it("rejects empty tasks", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-s1-"));
    const cfg = {
      paths: { configDir: dir },
      swarm: { enabled: true, maxParallel: 2, mergeEnabled: false },
    };
    const out = await runSwarmFanOut(cfg, { goal: "x", tasks: [] });
    assert.equal(out.ok, false);
    assert.match(out.error, /tasks required/);
  });

  it("rejects over maxChildrenPerRun", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-s1b-"));
    const cfg = {
      paths: { configDir: dir },
      swarm: { enabled: true, maxChildrenPerRun: 2, mergeEnabled: false },
    };
    const out = await runSwarmFanOut(cfg, {
      goal: "x",
      tasks: ["a", "b", "c"],
    });
    assert.equal(out.ok, false);
    assert.match(out.error, /too many tasks/);
  });

  it("disabled when swarm.enabled false", async () => {
    const out = await runSwarmFanOut(
      { swarm: { enabled: false } },
      { tasks: ["a"] }
    );
    assert.equal(out.ok, false);
    assert.match(out.error, /enabled is false/);
  });

  it("createSwarmRunTool exposes xclaw_swarm_run", () => {
    const tool = createSwarmRunTool({ cfg: { swarm: { enabled: true } } });
    assert.equal(tool.name, "xclaw_swarm_run");
    assert.ok(tool.parameters);
    assert.equal(typeof tool.execute, "function");
  });
});

describe("S1 runtime fan-out (mock spawnSubagent)", () => {
  it("runs string tasks and returns join summary", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-s1rt-"));
    const cfg = {
      paths: { configDir: dir },
      swarm: {
        enabled: true,
        maxParallel: 2,
        mergeEnabled: false,
        nodeRetries: 0,
      },
    };
    const events = [];
    const out = await runSwarmFanOut(cfg, {
      goal: "demo",
      tasks: ["alpha", "beta"],
      spawnSubagent: mockSpawn(),
      onEvent: (e) => events.push(e),
    });

    assert.equal(out.ok, true);
    assert.equal(out.status, "done");
    assert.ok(out.swarmId);
    assert.equal(out.results.length, 2);
    assert.ok(out.results.every((r) => r.ok));
    assert.match(out.summary, /Swarm join summary/);
    assert.ok(out.children.length >= 2);

    const starts = events.filter((e) => e.phase === "child_start");
    const dones = events.filter((e) => e.phase === "child_done");
    assert.ok(starts.length >= 2);
    assert.ok(dones.length >= 2);
  });

  it("partial status when one child fails", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-s1p-"));
    const cfg = {
      paths: { configDir: dir },
      swarm: {
        enabled: true,
        mergeEnabled: false,
        nodeRetries: 0,
      },
    };
    const out = await runSwarmFanOut(cfg, {
      goal: "partial",
      tasks: [
        { id: "ok1", task: "good", role: "research" },
        { id: "bad1", task: "bad", role: "research" },
      ],
      spawnSubagent: mockSpawn({ failIds: new Set(["bad1"]) }),
    });

    assert.equal(out.status, "partial");
    assert.equal(out.ok, false);
    const bad = out.results.find((r) => r.nodeId === "bad1");
    const good = out.results.find((r) => r.nodeId === "ok1");
    assert.equal(good.ok, true);
    assert.equal(bad.ok, false);
  });

  it("persists SwarmRun under configDir", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-s1store-"));
    const cfg = {
      paths: { configDir: dir },
      swarm: { enabled: true, mergeEnabled: false, nodeRetries: 0 },
    };
    const out = await runSwarmFanOut(cfg, {
      tasks: ["only"],
      spawnSubagent: mockSpawn(),
    });
    assert.ok(out.swarmId);
    const runs = await listSwarmRuns(cfg, { limit: 10 });
    assert.ok(runs.some((r) => r.id === out.swarmId));
    const rec = await getSwarmRun(cfg, out.swarmId);
    assert.ok(rec);
    assert.ok(rec.summary || rec.status);
  });

  it("respects maxParallel without dropping tasks", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-s1par-"));
    const cfg = {
      paths: { configDir: dir },
      swarm: {
        enabled: true,
        maxParallel: 1,
        mergeEnabled: false,
        nodeRetries: 0,
      },
    };
    let concurrent = 0;
    let maxConcurrent = 0;
    const spawn = async (opts) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
      return mockSpawn()(opts);
    };
    const out = await runSwarmFanOut(cfg, {
      tasks: ["a", "b", "c"],
      spawnSubagent: spawn,
    });
    assert.equal(out.results.length, 3);
    assert.ok(out.results.every((r) => r.ok));
    assert.equal(maxConcurrent, 1);
  });

  it("embeds goal and role prefix in spawn task text", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-s1goal-"));
    const cfg = {
      paths: { configDir: dir },
      swarm: { enabled: true, mergeEnabled: false, nodeRetries: 0 },
    };
    let seenTask = "";
    const out = await runSwarmFanOut(cfg, {
      goal: "Ship the feature",
      tasks: [{ id: "r1", task: "Investigate X", role: "research" }],
      spawnSubagent: async (opts) => {
        seenTask = opts.task;
        return mockSpawn()(opts);
      },
    });
    assert.equal(out.ok, true);
    assert.match(seenTask, /Ship the feature/);
    assert.match(seenTask, /Role: research/i);
    assert.match(seenTask, /Investigate X/);
  });
});
