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
import { resolveMergePolicy } from "../src/agents/swarm-merge.mjs";

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

describe("worktree merge untracked", () => {
  let repo;
  let wtPath;

  it("copies untracked files into main repo", async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-wtmerge-"));
    await run("git", ["init"], repo);
    await run("git", ["config", "user.email", "t@test"], repo);
    await run("git", ["config", "user.name", "t"], repo);
    await fs.writeFile(path.join(repo, "README"), "base");
    await run("git", ["add", "."], repo);
    await run("git", ["commit", "-m", "init"], repo);

    const wt = await createWorktree(repo);
    assert.equal(wt.ok, true);
    wtPath = wt.path;
    await fs.mkdir(path.join(wtPath, "live-swarm-demo"), { recursive: true });
    await fs.writeFile(path.join(wtPath, "live-swarm-demo/hello.txt"), "swarm-ok");

    const meta = await worktreeDiff(wtPath);
    assert.equal(meta.dirty, true);
    assert.ok(meta.untracked.length >= 1);

    const applied = await applyWorktreeMerge(repo, wtPath, { checkOnly: false });
    assert.equal(applied.ok, true);
    assert.ok(String(applied.method).includes("copy"));
    const body = await fs.readFile(
      path.join(repo, "live-swarm-demo/hello.txt"),
      "utf8"
    );
    assert.equal(body, "swarm-ok");
  });

  it("lab profile defaults autoMerge on", () => {
    const p = resolveMergePolicy({ profile: "lab", swarm: {} }, {});
    assert.equal(p.autoMerge, true);
  });

  it("prod profile defaults autoMerge off", () => {
    const p = resolveMergePolicy({ profile: "prod", swarm: {} }, {});
    assert.equal(p.autoMerge, false);
  });

  after(async () => {
    if (repo && wtPath) {
      await removeWorktree(repo, wtPath).catch(() => {});
    }
  });
});
