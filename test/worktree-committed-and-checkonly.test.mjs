import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import {
  applyWorktreeMerge,
  worktreeDiff,
  createWorktree,
  removeWorktree,
} from "../src/agents/worktree.mjs";

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function makeRepo(prefix) {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await run("git", ["init"], repo);
  await run("git", ["config", "user.email", "t@test"], repo);
  await run("git", ["config", "user.name", "t"], repo);
  await fs.writeFile(path.join(repo, "README"), "base\n");
  await run("git", ["add", "."], repo);
  await run("git", ["commit", "-m", "init"], repo);
  return repo;
}

/** Recursive listing of every path under dir (relative, sorted). */
async function treeSnapshot(dir) {
  const out = [];
  async function walk(d) {
    for (const ent of await fs.readdir(d, { withFileTypes: true })) {
      if (ent.name === ".git") continue;
      const p = path.join(d, ent.name);
      out.push(path.relative(dir, p) + (ent.isDirectory() ? "/" : ""));
      if (ent.isDirectory()) await walk(p);
    }
  }
  await walk(dir);
  return out.sort();
}

describe("worktree merge: committed work surfaces (2.3)", () => {
  let repo;
  let wtPath;

  it("child COMMITS in the worktree — diff is non-empty and merge applies it", async () => {
    repo = await makeRepo("xclaw-wtcommit-");
    const wt = await createWorktree(repo);
    assert.equal(wt.ok, true);
    wtPath = wt.path;

    // Child edits a tracked file AND commits — the old `git diff HEAD` saw nothing.
    await fs.writeFile(path.join(wtPath, "README"), "base\ncommitted-change\n");
    await run("git", ["add", "."], wtPath);
    await run("git", ["commit", "-m", "child work"], wtPath);

    const meta = await worktreeDiff(wtPath);
    assert.equal(meta.dirty, true, "committed-only worktree must be dirty");
    assert.equal(meta.committedCount, 1);
    assert.ok(meta.base, "base should be discovered via git-common-dir");
    assert.match(meta.diff, /committed-change/);

    const applied = await applyWorktreeMerge(repo, wtPath, { checkOnly: false });
    assert.equal(applied.ok, true, JSON.stringify(applied));
    const body = await fs.readFile(path.join(repo, "README"), "utf8");
    assert.match(body, /committed-change/);
  });

  it("mixed committed + uncommitted changes BOTH surface in one patch", async () => {
    const repo2 = await makeRepo("xclaw-wtmixed-");
    await fs.writeFile(path.join(repo2, "other.txt"), "other\n");
    await run("git", ["add", "."], repo2);
    await run("git", ["commit", "-m", "second file"], repo2);

    const wt = await createWorktree(repo2);
    assert.equal(wt.ok, true);
    try {
      // committed change
      await fs.writeFile(path.join(wt.path, "README"), "base\nfrom-commit\n");
      await run("git", ["add", "."], wt.path);
      await run("git", ["commit", "-m", "committed part"], wt.path);
      // uncommitted change on a different tracked file
      await fs.writeFile(path.join(wt.path, "other.txt"), "other\nuncommitted\n");

      const meta = await worktreeDiff(wt.path);
      assert.equal(meta.dirty, true);
      assert.match(meta.diff, /from-commit/);
      assert.match(meta.diff, /uncommitted/);

      const applied = await applyWorktreeMerge(repo2, wt.path, { checkOnly: false });
      assert.equal(applied.ok, true, JSON.stringify(applied));
      assert.match(await fs.readFile(path.join(repo2, "README"), "utf8"), /from-commit/);
      assert.match(await fs.readFile(path.join(repo2, "other.txt"), "utf8"), /uncommitted/);
    } finally {
      await removeWorktree(repo2, wt.path).catch(() => {});
    }
  });

  it("standalone repo (no linked worktree) falls back to HEAD semantics", async () => {
    const solo = await makeRepo("xclaw-wtsolo-");
    await fs.writeFile(path.join(solo, "README"), "base\nedit\n");
    const meta = await worktreeDiff(solo);
    assert.equal(meta.dirty, true);
    assert.equal(meta.committedCount, 0);
    assert.match(meta.diff, /edit/);
  });

  after(async () => {
    if (repo && wtPath) {
      await removeWorktree(repo, wtPath).catch(() => {});
    }
  });
});

describe("worktree merge: checkOnly is a pure dry-run (2.4)", () => {
  it("checkOnly on untracked dir + nested file writes NOTHING to the repo", async () => {
    const repo = await makeRepo("xclaw-wtcheck-");
    const wt = await createWorktree(repo);
    assert.equal(wt.ok, true);
    try {
      // untracked directory candidate (the branch that ran fs.cp unguarded)
      await fs.mkdir(path.join(wt.path, "newdir/sub"), { recursive: true });
      await fs.writeFile(path.join(wt.path, "newdir/sub/a.txt"), "a");
      // nested new file (the branch that ran fs.mkdir before the checkOnly return)
      await fs.mkdir(path.join(wt.path, "deep/nested/dirs"), { recursive: true });
      await fs.writeFile(path.join(wt.path, "deep/nested/dirs/b.txt"), "b");

      const before = await treeSnapshot(repo);
      const check = await applyWorktreeMerge(repo, wt.path, { checkOnly: true });
      const afterTree = await treeSnapshot(repo);

      assert.equal(check.ok, true, JSON.stringify(check));
      assert.deepEqual(
        afterTree,
        before,
        "checkOnly must leave the target repo byte-identical"
      );
      assert.ok(check.copied.length >= 2, "candidates still reported");

      // and the real apply still works afterwards
      const applied = await applyWorktreeMerge(repo, wt.path, { checkOnly: false });
      assert.equal(applied.ok, true, JSON.stringify(applied));
      assert.equal(
        await fs.readFile(path.join(repo, "newdir/sub/a.txt"), "utf8"),
        "a"
      );
      assert.equal(
        await fs.readFile(path.join(repo, "deep/nested/dirs/b.txt"), "utf8"),
        "b"
      );
    } finally {
      await removeWorktree(repo, wt.path).catch(() => {});
    }
  });
});
