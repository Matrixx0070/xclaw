import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "path";
import os from "os";
import {
  saveSubagentSnapshot,
  listPersistedSubagents,
  createSwarmRun,
  listSwarmRuns,
  reconcileStaleAgents,
} from "../src/agents/swarm-store.mjs";
import { subagentMetrics } from "../src/agents/spawn.mjs";

describe("S0 swarm store", () => {
  it("persists subagent snapshot", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-s0-"));
    const cfg = { paths: { configDir: dir } };
    await saveSubagentSnapshot(cfg, {
      id: "abc-123",
      task: "test task",
      status: "done",
      createdAt: new Date().toISOString(),
      result: { text: "hello" },
    });
    const list = await listPersistedSubagents(cfg);
    assert.ok(list.some((x) => x.id === "abc-123"));
  });

  it("createSwarmRun lists", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-s0b-"));
    const cfg = { paths: { configDir: dir } };
    const run = await createSwarmRun(cfg, { goal: "fan-out demo" });
    const runs = await listSwarmRuns(cfg);
    assert.ok(runs.some((r) => r.id === run.id));
  });

  it("reconcile marks stale running", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-s0c-"));
    const cfg = { paths: { configDir: dir } };
    await saveSubagentSnapshot(cfg, {
      id: "stale-1",
      task: "x",
      status: "running",
      createdAt: new Date().toISOString(),
    });
    const r = await reconcileStaleAgents(cfg, new Set());
    assert.ok(r.marked >= 1);
    const list = await listPersistedSubagents(cfg);
    assert.equal(list.find((x) => x.id === "stale-1").status, "interrupted");
  });

  it("subagentMetrics shape", () => {
    assert.equal(typeof subagentMetrics.spawned, "number");
    assert.equal(typeof subagentMetrics.running, "function");
  });
});
