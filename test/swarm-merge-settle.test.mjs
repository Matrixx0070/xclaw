/**
 * Same class as queue cancel overwritten by a long-running writer:
 * rejectMergeProposal persists rejected while approveMergeProposal is
 * inside unbounded applyWorktreeMerge. The in-memory proposal's terminal
 * write must not overwrite rejected with applied/failed/partial.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "os";
import { spawnSync } from "node:child_process";
import {
  settleAfterApprove,
  saveMergeProposal,
  getMergeProposal,
  approveMergeProposal,
  rejectMergeProposal,
} from "../src/agents/swarm-merge.mjs";
import { createWorktree, removeWorktree } from "../src/agents/worktree.mjs";

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

describe("settleAfterApprove", () => {
  const held = () => ({ id: "prop_a", status: "pending" });

  it("does not resurrect a missing file", () => {
    assert.equal(settleAfterApprove(held(), null), null);
  });

  it("does not overwrite a different proposal", () => {
    assert.equal(settleAfterApprove(held(), { id: "prop_b", status: "pending" }), null);
  });

  it("does not overwrite rejected", () => {
    assert.equal(settleAfterApprove(held(), { id: "prop_a", status: "rejected" }), null);
  });

  it("returns held when on-disk is still pending", () => {
    const h = held();
    assert.equal(settleAfterApprove(h, { id: "prop_a", status: "pending" }), h);
  });

  it("does not resurrect when held is missing", () => {
    assert.equal(settleAfterApprove(null, { id: "prop_a", status: "pending" }), null);
  });
});

describe("approveMergeProposal does not overwrite a concurrent reject", () => {
  let dir;
  let repo;
  let wt;

  before(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-swarm-merge-settle-"));
    repo = path.join(dir, "repo");
    fs.mkdirSync(repo);
    git(["init", "-q"], repo);
    git(["config", "user.email", "t@x"], repo);
    git(["config", "user.name", "t"], repo);
    fs.writeFileSync(path.join(repo, "a.js"), "one\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "init"], repo);
    const w = await createWorktree(repo, { branchPrefix: "swm" });
    assert.equal(w.ok, true, w.error);
    wt = w.path;
    fs.writeFileSync(path.join(wt, "a.js"), "two\n");
  });

  after(async () => {
    try {
      if (wt) await removeWorktree(repo, wt);
    } catch {}
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("leaves rejected on disk when reject lands during applyWorktreeMerge", async () => {
    // applyWorktreeMerge does not commit (approve commits after the write),
    // so a pre-commit hook cannot delay the overwrite. Slow `git apply`
    // via a PATH wrapper scoped to this it() so reject can land during
    // apply --check / apply. Restore PATH in finally — do not leak.
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin, { recursive: true });
    const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
    assert.ok(realGit, "git on PATH");
    fs.writeFileSync(
      path.join(bin, "git"),
      `#!/bin/sh\ncase " $* " in\n  *" apply "*) sleep 1 ;;\nesac\nexec ${JSON.stringify(realGit)} "$@"\n`,
      { mode: 0o755 }
    );
    const origPath = process.env.PATH;
    process.env.PATH = bin + path.delimiter + origPath;
    try {
      const cfg = { paths: { configDir: dir }, swarm: { commitAfterMerge: false } };
      const rec = await saveMergeProposal(cfg, {
        repoDir: repo,
        policy: { cleanupWorktree: false, requireCleanMain: false, useIndex: false },
        items: [{ nodeId: "impl", worktreePath: wt }],
      });
      const approveP = approveMergeProposal(cfg, rec.id, {
        principal: "operator",
        repoDir: repo,
        commit: false,
      });
      await new Promise((r) => setTimeout(r, 200));
      const rb = await rejectMergeProposal(cfg, rec.id, "operator reject");
      assert.equal(rb.status, "rejected");
      await approveP;
      const onDisk = await getMergeProposal(cfg, rec.id);
      assert.equal(onDisk.status, "rejected");
      assert.notEqual(onDisk.status, "applied");
      assert.notEqual(onDisk.status, "failed");
      assert.notEqual(onDisk.status, "partial");
    } finally {
      process.env.PATH = origPath;
    }
  });

  it("is wired after cleanliness, at loop-top, and before the terminal write", async () => {
    const src = await fsp.readFile(new URL("../src/agents/swarm-merge.mjs", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export async function approveMergeProposal"));
    const end = body.indexOf("export async function rejectMergeProposal");
    const approve = end > 0 ? body.slice(0, end) : body;
    const afterClean = approve.indexOf("settleAfterApprove(rec, afterClean)");
    const loopTop = approve.indexOf("settleAfterApprove(rec, latest)");
    const beforeSave = approve.indexOf("settleAfterApprove(rec, beforeSave)");
    const write = approve.lastIndexOf("await fs.writeFile(");
    assert.ok(afterClean >= 0, "re-read after cleanliness");
    assert.ok(loopTop > afterClean, "re-read at apply loop top");
    assert.ok(beforeSave > loopTop, "re-read before terminal write");
    assert.ok(write > beforeSave, "terminal write is after the pre-save settle");
  });
});
