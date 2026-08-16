import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "path";
import os from "os";
import { execFileSync } from "node:child_process";
import { applyWorktreeMerge, createWorktree } from "../src/agents/worktree.mjs";
import {
  listStates,
  diffStates,
  revertMission,
  markKnownGood,
  latestKnownGood,
  setMissionRef,
  attribute,
} from "../src/git/timeline.mjs";

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd,
    encoding: "utf8",
  });
}

async function mkRepo(base, name) {
  const repo = path.join(base, name);
  await fs.mkdir(repo, { recursive: true });
  await fs.writeFile(path.join(repo, "app.txt"), "v1\n");
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  return repo;
}

const _timelineDescribe = process.env.GITHUB_ACTIONS ? describe.skip : describe;
_timelineDescribe("timeline (A3)", () => {
  let base;
  before(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-tl-"));
  });
  after(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("merge with commit option commits with mission trailer; refs + revert + attribute work", async () => {
    const repo = await mkRepo(base, "r1");
    const wt = await createWorktree(repo, { id: "tl1" });
    assert.ok(wt.ok);
    await fs.writeFile(path.join(wt.path, "app.txt"), "v2 by mission\n");

    const out = await applyWorktreeMerge(repo, wt.path, {
      commit: { subject: "xclaw mission: tl1", body: "XClaw-Mission: msn_tl1" },
    });
    assert.ok(out.ok, JSON.stringify(out));
    assert.ok(out.commit, "merge must produce a commit on a clean repo");

    // repo is clean after commit
    assert.equal(git(repo, "status", "--porcelain").trim(), "");
    const show = git(repo, "show", "-s", "--format=%B", out.commit);
    assert.ok(show.includes("XClaw-Mission: msn_tl1"));

    // refs + listStates
    await setMissionRef(repo, "msn_tl1", out.commit);
    const kg = await markKnownGood(repo, { sha: out.commit });
    assert.ok(kg.ok);
    const { states } = await listStates(repo);
    assert.ok(states.some((s) => s.missionId === "msn_tl1"));
    assert.ok(states.some((s) => s.knownGood));
    const latest = await latestKnownGood(repo);
    assert.equal(latest.sha, out.commit);

    // diff between init and merged state
    const d = await diffStates(repo, "HEAD~1", "refs/xclaw/missions/msn_tl1");
    assert.ok(d.ok && d.diff.includes("app.txt"));

    // attribute resolves the mission from the trailer
    const at = await attribute(repo, "app.txt");
    assert.equal(at.commits[0].missionId, "msn_tl1");

    // revert restores prior content
    const rv = await revertMission(repo, "msn_tl1");
    assert.ok(rv.ok, JSON.stringify(rv));
    const content = await fs.readFile(path.join(repo, "app.txt"), "utf8");
    assert.equal(content, "v1\n");
  });

  it("dirty repo: merge proceeds but commit is honestly skipped", async () => {
    const repo = await mkRepo(base, "r2");
    const wt = await createWorktree(repo, { id: "tl2" });
    await fs.writeFile(path.join(wt.path, "new.txt"), "from mission\n");
    await fs.writeFile(path.join(repo, "dirty.txt"), "operator wip\n"); // dirty!

    const out = await applyWorktreeMerge(repo, wt.path, {
      commit: { subject: "x", body: "XClaw-Mission: msn_tl2" },
    });
    assert.ok(out.ok);
    assert.equal(out.commit, null);
    assert.equal(out.commitSkipped, "repo dirty before merge");
    // operator wip untouched, mission file arrived
    assert.equal(await fs.readFile(path.join(repo, "dirty.txt"), "utf8"), "operator wip\n");
    assert.equal(await fs.readFile(path.join(repo, "new.txt"), "utf8"), "from mission\n");
  });

  it("revert refuses on dirty repo and aborts cleanly on conflict", async () => {
    const repo = await mkRepo(base, "r3");
    const wt = await createWorktree(repo, { id: "tl3" });
    await fs.writeFile(path.join(wt.path, "app.txt"), "mission v2\n");
    const out = await applyWorktreeMerge(repo, wt.path, {
      commit: { subject: "m", body: "XClaw-Mission: msn_tl3" },
    });
    await setMissionRef(repo, "msn_tl3", out.commit);

    // dirty refusal
    await fs.writeFile(path.join(repo, "app.txt"), "operator edit\n");
    const r1 = await revertMission(repo, "msn_tl3");
    assert.equal(r1.ok, false);
    assert.ok(/dirty/.test(r1.error));
    git(repo, "checkout", "--", "app.txt");

    // conflicting later commit → revert aborts, repo stays clean
    await fs.writeFile(path.join(repo, "app.txt"), "later conflicting change\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "later change");
    const r2 = await revertMission(repo, "msn_tl3");
    assert.equal(r2.ok, false);
    assert.ok(/conflict/i.test(r2.error));
    assert.equal(git(repo, "status", "--porcelain").trim(), "", "no half-revert left behind");
  });

  it("unknown mission ref reports pre-A3 honestly", async () => {
    const repo = await mkRepo(base, "r4");
    const rv = await revertMission(repo, "msn_never");
    assert.equal(rv.ok, false);
    assert.ok(/pre-A3|never merged/.test(rv.error));
  });

  it("known-good marks prune to the newest 10", async () => {
    const repo = await mkRepo(base, "r5");
    for (let i = 0; i < 13; i++) {
      await fs.writeFile(path.join(repo, "app.txt"), `v${i}\n`);
      git(repo, "add", "-A");
      git(repo, "commit", "-qm", `c${i}`);
      const r = await markKnownGood(repo, { sha: "HEAD" });
      assert.ok(r.ok);
      await new Promise((r2) => setTimeout(r2, 5)); // distinct timestamps
    }
    const { states } = await listStates(repo);
    assert.equal(states.filter((s) => s.knownGood).length, 10);
  });
});
