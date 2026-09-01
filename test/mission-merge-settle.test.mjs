/**
 * Same class as queue cancel overwritten by a long-running writer:
 * rollbackMission persists rolled_back (and is not in `running`, so abort
 * is a no-op) while mergeMission is inside unbounded applyWorktreeMerge.
 * The in-memory mission's terminal write must not overwrite rolled_back
 * with done/deploying, and must not requestDeploy over a rolled-back mission.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "os";
import { spawnSync } from "node:child_process";
import { settleAfterMerge, mergeMission, rollbackMission } from "../src/missions/engine.mjs";
import { newMission, saveMission, loadMission } from "../src/missions/store.mjs";
import { createWorktree, removeWorktree } from "../src/agents/worktree.mjs";

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

describe("settleAfterMerge", () => {
  const held = () => ({ id: "msn_a", status: "merging" });

  it("does not resurrect a missing file", () => {
    assert.equal(settleAfterMerge(held(), null), null);
  });

  it("does not overwrite a different mission", () => {
    assert.equal(settleAfterMerge(held(), { id: "msn_b", status: "merging" }), null);
  });

  it("does not overwrite rolled_back", () => {
    assert.equal(settleAfterMerge(held(), { id: "msn_a", status: "rolled_back" }), null);
  });

  it("does not overwrite done", () => {
    assert.equal(settleAfterMerge(held(), { id: "msn_a", status: "done" }), null);
  });

  it("does not overwrite deployed", () => {
    assert.equal(settleAfterMerge(held(), { id: "msn_a", status: "deployed" }), null);
  });

  it("returns held when on-disk is still merging", () => {
    const h = held();
    assert.equal(settleAfterMerge(h, { id: "msn_a", status: "merging" }), h);
  });

  it("does not resurrect when held is missing", () => {
    assert.equal(settleAfterMerge(null, { id: "msn_a", status: "merging" }), null);
  });
});

describe("mergeMission does not overwrite a concurrent rollback", () => {
  let dir;
  let repo;
  let wt;

  before(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-merge-settle-"));
    repo = path.join(dir, "repo");
    fs.mkdirSync(repo);
    git(["init", "-q"], repo);
    git(["config", "user.email", "t@x"], repo);
    git(["config", "user.name", "t"], repo);
    fs.writeFileSync(path.join(repo, "a.js"), "one\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "init"], repo);
    const w = await createWorktree(repo, { branchPrefix: "msn" });
    assert.equal(w.ok, true, w.error);
    wt = w.path;
    fs.writeFileSync(path.join(wt, "a.js"), "two\n");
    // Slow the commit-on-merge so rollback can land during applyWorktreeMerge.
    const hookDir = path.join(repo, ".git", "hooks");
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(path.join(hookDir, "pre-commit"), "#!/bin/sh\nsleep 1\nexit 0\n", { mode: 0o755 });
  });

  after(async () => {
    try {
      if (wt) await removeWorktree(repo, wt);
    } catch {}
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("leaves rolled_back on disk when rollback lands during applyWorktreeMerge", async () => {
    const cfg = { paths: { configDir: dir } };
    const mission = newMission({ goal: "change a.js", repoDir: repo });
    mission.status = "merge_ready";
    mission.worktree = { path: wt, branch: "msn" };
    await saveMission(cfg, mission);

    const mergeP = mergeMission(cfg, mission.id);
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 40));
      const cur = await loadMission(cfg, mission.id);
      if (cur?.status === "merging") break;
    }
    const rb = await rollbackMission(cfg, mission.id);
    assert.equal(rb.status, "rolled_back");
    await mergeP;
    const onDisk = await loadMission(cfg, mission.id);
    assert.equal(onDisk.status, "rolled_back");
    assert.notEqual(onDisk.status, "done");
    assert.notEqual(onDisk.status, "deploying");
  });

  it("is wired after applyWorktreeMerge and before requestDeploy / terminal save", async () => {
    const src = await fsp.readFile(new URL("../src/missions/engine.mjs", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export async function mergeMission"));
    const apply = body.indexOf("await applyWorktreeMerge");
    const firstSettle = body.indexOf("settleAfterMerge(mission, afterMerge)", apply);
    const requestDeploy = body.indexOf("await requestDeploy");
    const beforeDeploy = body.indexOf("settleAfterMerge(mission, beforeDeploy)");
    const beforeSave = body.indexOf("settleAfterMerge(mission, beforeSave)");
    const terminalSave = body.lastIndexOf("await saveMission(cfg, mission)");
    assert.ok(apply >= 0, "applyWorktreeMerge present");
    assert.ok(firstSettle > apply, "re-read after applyWorktreeMerge");
    assert.ok(beforeDeploy > firstSettle, "re-read before requestDeploy");
    assert.ok(requestDeploy > beforeDeploy, "requestDeploy is after the pre-deploy settle");
    assert.ok(beforeSave > requestDeploy, "re-read before terminal save");
    assert.ok(terminalSave > beforeSave, "terminal save is after the pre-save settle");
  });
});
