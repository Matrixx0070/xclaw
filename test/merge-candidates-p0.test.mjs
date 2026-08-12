import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { collectMergeCandidates } from "../src/agents/swarm-merge.mjs";
import { applyWorktreeMerge } from "../src/agents/worktree.mjs";

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

describe("merge candidates P0", () => {
  it("excludes verify/research; includes implement", () => {
    const c = collectMergeCandidates([
      {
        ok: true,
        role: "implement",
        nodeId: "i",
        id: "c1",
        workspace: "/tmp/wt-impl",
      },
      {
        ok: true,
        role: "verify",
        nodeId: "v",
        id: "c2",
        workspace: "/home/workdir/artifacts/xclaw",
      },
      {
        ok: true,
        role: "research",
        nodeId: "r",
        id: "c3",
        workspace: "/tmp/research",
      },
    ]);
    assert.equal(c.length, 1);
    assert.equal(c[0].nodeId, "i");
  });

  it("allows explicit merge:true on non-implement", () => {
    const c = collectMergeCandidates([
      {
        ok: true,
        role: "actor",
        merge: true,
        nodeId: "a",
        workspace: "/tmp/actor-wt",
      },
    ]);
    assert.equal(c.length, 1);
  });

  it("skips already early-merged implement", () => {
    const c = collectMergeCandidates([
      {
        ok: true,
        role: "implement",
        nodeId: "i",
        workspace: "/tmp/wt",
        mergedToMain: true,
      },
    ]);
    assert.equal(c.length, 0);
  });

  it("same-tree apply is noop ok", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-same-"));
    await run("git", ["init"], repo);
    await run("git", ["config", "user.email", "t@t"], repo);
    await run("git", ["config", "user.name", "t"], repo);
    await fs.writeFile(path.join(repo, "R"), "x");
    await run("git", ["add", "."], repo);
    await run("git", ["commit", "-m", "i"], repo);
    const r = await applyWorktreeMerge(repo, repo, { checkOnly: true });
    assert.equal(r.ok, true);
    assert.equal(r.method, "same-tree");
  });
});
