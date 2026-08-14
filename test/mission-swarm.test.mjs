import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { parseMissionTasks, startMission } from "../src/missions/engine.mjs";
import { loadMission } from "../src/missions/store.mjs";
import { createWorktree } from "../src/agents/worktree.mjs";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

describe("parseMissionTasks", () => {
  it("extracts the LAST fenced task graph and validates it", () => {
    const text = [
      "Plan text…",
      "```xclaw-mission-tasks",
      '[{"id":"old","role":"implement","task":"stale"}]',
      "```",
      "revised:",
      "```xclaw-mission-tasks",
      '[{"id":"a","role":"implement","task":"build a"},{"id":"b","role":"verify","task":"check a","dependsOn":["a"]}]',
      "```",
    ].join("\n");
    const tasks = parseMissionTasks(text);
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].id, "a");
    assert.deepEqual(tasks[1].dependsOn, ["a"]);
  });
  it("returns null on missing block / bad JSON / invalid graph", () => {
    assert.equal(parseMissionTasks("no block here"), null);
    assert.equal(parseMissionTasks("```xclaw-mission-tasks\nnot json\n```"), null);
    assert.equal(
      parseMissionTasks('```xclaw-mission-tasks\n[{"id":"a","role":"implement","task":"x","dependsOn":["ghost"]}]\n```'),
      null,
      "unknown dependency rejected"
    );
  });
});

describe("swarm-backed mission (hermetic, injected spawn)", () => {
  it("fan-out nodes early-merge into the mission worktree; evidence includes their files; mission reaches merge_ready", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-msn-swarm-"));
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    git(["init", "-q"], repo);
    git(["config", "user.email", "t@x"], repo);
    git(["config", "user.name", "t"], repo);
    fs.writeFileSync(path.join(repo, "base.txt"), "base\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "init"], repo);

    const cfg = {
      paths: { configDir: path.join(tmp, "cfgdir") },
      missions: {},
      swarm: {},
      agent: { persistTranscript: false },
      tokens: { enabled: false, ledger: false },
      security: { autoApprove: true },
    };

    // fake node agent: for implement nodes, do REAL worktree work so the
    // early-merge path is exercised end to end
    const spawnCalls = [];
    async function fakeSpawn(opts) {
      spawnCalls.push({ task: opts.task.slice(0, 60), worktree: opts.worktree, workingDir: opts.workingDir, hasGate: Boolean(opts.approvalGate) });
      if (opts.worktree) {
        const wt = await createWorktree(opts.workingDir);
        assert.equal(wt.ok, true, wt.error);
        const m = opts.task.match(/Subtask \((\w+)\)/);
        const nodeId = m ? m[1] : "n";
        fs.writeFileSync(path.join(wt.path, `${nodeId}.txt`), `made by ${nodeId}\n`);
        return {
          id: `sub-${nodeId}`, ok: true, status: "done",
          worktree: { path: wt.path, branch: wt.branch },
          workspace: wt.path,
          result: { text: `done ${nodeId}`, turns: 1, worktree: { path: wt.path, branch: wt.branch }, workspace: wt.path },
        };
      }
      return { id: "sub-x", ok: true, status: "done", result: { text: "researched", turns: 1 } };
    }

    const mission = await startMission(cfg, {
      goal: "swarm goal",
      repoDir: repo,
      strategy: "swarm",
      tasks: [
        { id: "a", role: "implement", task: "create a.txt" },
        { id: "b", role: "implement", task: "create b.txt" },
      ],
      verify: ['node -e "process.exit(0)"'],
      spawnSubagent: fakeSpawn,
    });
    assert.equal(mission.strategy, "swarm");

    let final = null;
    for (let i = 0; i < 300; i++) {
      final = await loadMission(cfg, mission.id);
      if (["merge_ready", "failed", "done"].includes(final.status)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(final.status, "merge_ready", `mission ${final.status}: ${final.error || ""}`);
    // no plan-phase model run needed (explicit tasks) but plan is created by
    // the engine only when absent — with explicit tasks the plan phase still
    // runs a model… we injected no provider, so plan must NOT have run:
    // strategy=swarm with explicit tasks means the graph came from opts.
    assert.equal((final.swarm.tasks || []).length, 2);
    assert.equal(final.swarm.nodes.length, 2);
    assert.ok(final.swarm.nodes.every((n) => n.ok), JSON.stringify(final.swarm.nodes));
    assert.ok(final.swarm.nodes.every((n) => n.merged), "implement nodes early-merged into mission worktree");
    assert.ok(final.swarm.runId, "swarm run persisted");
    // node work must be IN the mission worktree and IN the evidence
    assert.ok(fs.existsSync(path.join(final.worktree.path, "a.txt")));
    assert.ok(fs.existsSync(path.join(final.worktree.path, "b.txt")));
    assert.ok(final.diff.untracked.includes("a.txt") && final.diff.untracked.includes("b.txt"),
      `untracked evidence: ${JSON.stringify(final.diff.untracked)}`);
    // the real repo is still untouched
    assert.equal(fs.existsSync(path.join(repo, "a.txt")), false);
    // approval gate was threaded to every node spawn
    assert.ok(spawnCalls.every((c) => c.hasGate), "approvalGate reached node spawns");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
