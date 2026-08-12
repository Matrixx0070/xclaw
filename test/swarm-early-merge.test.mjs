import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { mergeImplementNodeEarly } from "../src/agents/swarm-run.mjs";
import { createWorktree, removeWorktree } from "../src/agents/worktree.mjs";

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

describe("swarm early merge after implement (option A)", () => {
  it("mergeImplementNodeEarly copies untracked into main", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-early-"));
    await run("git", ["init"], repo);
    await run("git", ["config", "user.email", "t@t"], repo);
    await run("git", ["config", "user.name", "t"], repo);
    await fs.writeFile(path.join(repo, "README"), "base");
    await run("git", ["add", "."], repo);
    await run("git", ["commit", "-m", "init"], repo);

    const wt = await createWorktree(repo);
    assert.equal(wt.ok, true);
    await fs.mkdir(path.join(wt.path, "live-swarm-demo"), { recursive: true });
    await fs.writeFile(path.join(wt.path, "live-swarm-demo/hello.txt"), "swarm-ok");

    const events = [];
    const result = {
      ok: true,
      role: "implement",
      nodeId: "implement",
      workspace: wt.path,
      worktree: { path: wt.path },
    };
    const cfg = { profile: "lab", swarm: { autoMergeLab: true } };
    const early = await mergeImplementNodeEarly(
      cfg,
      result,
      { workingDir: repo, autoMerge: true },
      (e) => events.push(e)
    );
    assert.equal(early.ok, true);
    assert.equal(early.skipped, undefined);
    const body = await fs.readFile(
      path.join(repo, "live-swarm-demo/hello.txt"),
      "utf8"
    );
    assert.equal(body, "swarm-ok");
    assert.ok(events.some((e) => e.phase === "merge_early_applied"));
    await removeWorktree(repo, wt.path).catch(() => {});
  });

  it("skips non-implement roles", async () => {
    const early = await mergeImplementNodeEarly(
      { profile: "lab" },
      { ok: true, role: "verify", nodeId: "v", workspace: "/tmp" },
      { autoMerge: true }
    );
    assert.equal(early, null);
  });
});
