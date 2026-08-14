import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  matchesPathPattern,
  partitionUntrackedByExcludes,
  untrackedPatch,
  applyWorktreeMerge,
  createWorktree,
  removeWorktree,
} from "../src/agents/worktree.mjs";
import {
  missionCfg,
  missionMergeExcludes,
  DEFAULT_MISSION_TOOLS,
} from "../src/missions/engine.mjs";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

describe("matchesPathPattern / partitionUntrackedByExcludes", () => {
  it("directory patterns cover the dir and everything under it", () => {
    assert.equal(matchesPathPattern("node_modules/a/b.js", "node_modules/**"), true);
    assert.equal(matchesPathPattern("node_modules", "node_modules/**"), true);
    assert.equal(matchesPathPattern("node_modules/a", "node_modules"), true);
    assert.equal(matchesPathPattern("src/node_modulesish.js", "node_modules/**"), false);
  });
  it("exact and basename-glob patterns", () => {
    assert.equal(matchesPathPattern("package-lock.json", "package-lock.json"), true);
    assert.equal(matchesPathPattern("src/package-lock.json", "package-lock.json"), false);
    assert.equal(matchesPathPattern("npm-debug.log.123", "npm-debug.log*"), true);
    assert.equal(matchesPathPattern("deep/dir/npm-debug.log", "npm-debug.log*"), true);
  });
  it("partition splits kept vs excluded", () => {
    const { kept, excluded } = partitionUntrackedByExcludes(
      ["src/new.js", "node_modules/x.js", "package-lock.json"],
      ["node_modules/**", "package-lock.json"]
    );
    assert.deepEqual(kept, ["src/new.js"]);
    assert.deepEqual(excluded, ["node_modules/x.js", "package-lock.json"]);
  });
});

describe("worktree merge with excludeUntracked + untracked evidence", () => {
  let repo, wt;

  before(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-merge-ev-"));
    git(["init", "-q"], repo);
    git(["config", "user.email", "t@x"], repo);
    git(["config", "user.name", "t"], repo);
    fs.writeFileSync(path.join(repo, "a.js"), "console.log(1);\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "init"], repo);
    const w = await createWorktree(repo, { branchPrefix: "test" });
    assert.equal(w.ok, true);
    wt = w.path;
    // tracked change + real new file + ecosystem junk
    fs.writeFileSync(path.join(wt, "a.js"), "console.log(2);\n");
    fs.writeFileSync(path.join(wt, "feature.js"), "export const f = 1;\n");
    fs.mkdirSync(path.join(wt, "node_modules", "dep"), { recursive: true });
    fs.writeFileSync(path.join(wt, "node_modules", "dep", "i.js"), "junk\n");
    fs.writeFileSync(path.join(wt, "package-lock.json"), "{}\n");
  });

  after(async () => {
    try { await removeWorktree(repo, wt); } catch {}
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("untrackedPatch synthesizes git-style new-file diffs with content", async () => {
    const p = await untrackedPatch(wt, ["feature.js"]);
    assert.match(p, /feature\.js/);
    assert.match(p, /\+export const f = 1;/);
  });

  it("merge copies real new files, never excluded artifacts; reports both", async () => {
    const out = await applyWorktreeMerge(repo, wt, {
      excludeUntracked: ["node_modules/**", "package-lock.json"],
    });
    assert.equal(out.ok, true, out.error || "merge failed");
    assert.ok(out.copied.includes("feature.js"), "new file merged");
    assert.ok(
      fs.existsSync(path.join(repo, "feature.js")),
      "feature.js landed in repo"
    );
    assert.equal(
      fs.existsSync(path.join(repo, "node_modules")),
      false,
      "node_modules never copied"
    );
    assert.equal(
      fs.existsSync(path.join(repo, "package-lock.json")),
      false,
      "lockfile never copied"
    );
    assert.ok(out.excluded.includes("package-lock.json"));
    assert.ok(out.excluded.some((r) => r.startsWith("node_modules/")));
    // tracked change applied too
    assert.match(fs.readFileSync(path.join(repo, "a.js"), "utf8"), /console\.log\(2\)/);
  });
});

describe("missionCfg tool scoping + merge excludes", () => {
  it("defaults mission agents to the code-work allowlist", () => {
    const c = missionCfg({ agent: {} }, "/tmp/wt");
    assert.deepEqual(c.agent.allowTools, DEFAULT_MISSION_TOOLS);
    assert.ok(c.agent.allowTools.includes("xclaw_bash"));
    assert.ok(!c.agent.allowTools.some((p) => p.startsWith("mcp__")),
      "no MCP surface under blanket mission autoApprove");
  });
  it("cfg.missions.allowTools overrides; false disables the filter", () => {
    const custom = missionCfg({ missions: { allowTools: ["xclaw_bash"] } }, "/wt");
    assert.deepEqual(custom.agent.allowTools, ["xclaw_bash"]);
    const off = missionCfg({ missions: { allowTools: false } }, "/wt");
    assert.equal(off.agent.allowTools, undefined);
  });
  it("missionMergeExcludes = defaults (or override) + verify artifacts", () => {
    const m = { verify: { artifacts: ["coverage/tmp.json"] } };
    const ex = missionMergeExcludes({}, m);
    assert.ok(ex.includes("node_modules/**"));
    assert.ok(ex.includes("coverage/tmp.json"));
    const custom = missionMergeExcludes({ missions: { mergeExclude: ["only-this"] } }, m);
    assert.deepEqual(custom, ["only-this", "coverage/tmp.json"]);
  });
});

describe("resume of a failed mission cannot bypass the evidence gate", () => {
  it("failed → resumes at verification; no checks → failed again, never merge_ready", async () => {
    const os = await import("node:os");
    const tmp = fs.mkdtempSync(path.join(os.default.tmpdir(), "xclaw-resume-gate-"));
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    git(["init", "-q"], repo);
    git(["config", "user.email", "t@x"], repo);
    git(["config", "user.name", "t"], repo);
    fs.writeFileSync(path.join(repo, "a.txt"), "x\n"); // no package.json → no detectable checks
    git(["add", "."], repo);
    git(["commit", "-qm", "init"], repo);
    const w = await createWorktree(repo, { branchPrefix: "gate" });
    assert.equal(w.ok, true);

    const cfg = { paths: { configDir: path.join(tmp, "cfgdir") }, missions: {} };
    const { newMission, saveMission, loadMission } = await import("../src/missions/store.mjs");
    const { resumeMission } = await import("../src/missions/engine.mjs");
    const mission = newMission({ goal: "g", repoDir: repo });
    mission.status = "failed";
    mission.error = "boom (simulated prior model error)";
    mission.plan = { summary: "plan", contextFiles: [] };
    mission.worktree = { path: w.path, branch: w.branch };
    await saveMission(cfg, mission);

    const res = await resumeMission(cfg, mission.id, {});
    // wait for the background run to settle
    for (let i = 0; i < 100; i++) {
      const m = await loadMission(cfg, mission.id);
      if (["merge_ready", "failed", "done"].includes(m.status)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const final = await loadMission(cfg, mission.id);
    assert.notEqual(final.status, "merge_ready",
      "resume of failed mission must NOT reach merge_ready without passing verification");
    assert.equal(final.status, "failed");
    assert.match(String(final.error || ""), /no verification commands/);
    void res;
    try { await removeWorktree(repo, w.path); } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("mission autonomy survives a gateway-primed shared approval gate", () => {
  it("bash executes under mission autoApprove even when the shared gate says no", async () => {
    const os = await import("node:os");
    const { resetSharedApprovalGate } = await import("../src/security/approvals.mjs");
    // simulate a live gateway boot: shared gate primed with autoApprove:false
    resetSharedApprovalGate({ security: { autoApprove: false, approvalTimeoutMs: 300, approvalSlaMs: 300 } });

    const tmp = fs.mkdtempSync(path.join(os.default.tmpdir(), "xclaw-msn-gate-"));
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    git(["init", "-q"], repo);
    git(["config", "user.email", "t@x"], repo);
    git(["config", "user.name", "t"], repo);
    fs.writeFileSync(path.join(repo, "a.txt"), "x\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "init"], repo);

    const cfg = {
      paths: { configDir: path.join(tmp, "cfgdir") },
      missions: {},
      agent: { persistTranscript: false },
      tokens: { enabled: false, ledger: false },
      skills: { enabled: false },
      memory: { enabled: false },
      computer: { autoStart: false },
      security: { autoApprove: false, approvalTimeoutMs: 300, approvalSlaMs: 300 },
      hooks: { log: false },
    };
    let n = 0;
    const provider = {
      providerName: "fake", model: "fake-1", baseUrl: "http://127.0.0.1:1",
      async chat() {
        n += 1;
        // each phase: first a bash call, then done — bash must AUTO-approve
        if (n % 2 === 1) {
          return {
            message: {
              role: "assistant", content: "",
              tool_calls: [{ id: `b${n}`, function: { name: "xclaw_bash", arguments: JSON.stringify({ command: "echo mission-ok" }) } }],
            },
            finishReason: "tool_calls",
          };
        }
        return { message: { role: "assistant", content: "phase done" }, finishReason: "stop" };
      },
    };
    const events = [];
    const { startMission } = await import("../src/missions/engine.mjs");
    const { loadMission } = await import("../src/missions/store.mjs");
    const mission = await startMission(cfg, {
      goal: "test goal",
      repoDir: repo,
      verify: ["node -e \"process.exit(0)\""],
      provider,
      onEvent: (e) => events.push(e),
    });
    let final = null;
    for (let i = 0; i < 200; i++) {
      final = await loadMission(cfg, mission.id);
      if (["merge_ready", "failed", "done"].includes(final.status)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(final.status, "merge_ready", `mission ended ${final.status}: ${final.error || ""}`);
    const approvalEvents = events.filter((e) => e.type === "security" && e.phase === "approval_required");
    assert.equal(approvalEvents.length, 0,
      "mission bash must never pend for human approval (dedicated mission gate)");
    const bashEnd = events.find((e) => e.type === "tool" && e.phase === "end" && e.name === "xclaw_bash");
    assert.ok(bashEnd, "bash actually executed");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
