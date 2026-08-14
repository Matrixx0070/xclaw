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
