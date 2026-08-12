import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyPatchError,
  classifyCopyError,
  classifyCopyConflicts,
  MERGE_ERROR_CODES,
  applyWorktreeMerge,
} from "../src/agents/worktree.mjs";
import { collectMergeCandidates } from "../src/agents/swarm-merge.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

describe("P1 merge error codes", () => {
  it("classifies corrupt patch", () => {
    assert.equal(
      classifyPatchError("error: corrupt patch at line 158"),
      MERGE_ERROR_CODES.PATCH_CORRUPT
    );
  });

  it("classifies reject / does not apply", () => {
    assert.equal(
      classifyPatchError("error: patch does not apply"),
      MERGE_ERROR_CODES.PATCH_REJECT
    );
    assert.equal(
      classifyPatchError("error: while searching for:"),
      MERGE_ERROR_CODES.PATCH_REJECT
    );
  });

  it("classifies copy errors", () => {
    assert.equal(
      classifyCopyError("skip unsafe path: ../x"),
      MERGE_ERROR_CODES.UNSAFE_PATH
    );
    assert.equal(
      classifyCopyError("file already exists"),
      MERGE_ERROR_CODES.COPY_EXISTS
    );
  });

  it("prefers UNSAFE_PATH among copy conflicts", () => {
    assert.equal(
      classifyCopyConflicts([
        "foo: EEXIST",
        "skip unsafe path: ../x",
      ]),
      MERGE_ERROR_CODES.UNSAFE_PATH
    );
  });

  it("same-tree returns SAME_TREE code", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-code-"));
    await run("git", ["init"], repo);
    await run("git", ["config", "user.email", "t@t"], repo);
    await run("git", ["config", "user.name", "t"], repo);
    await fs.writeFile(path.join(repo, "R"), "x");
    await run("git", ["add", "."], repo);
    await run("git", ["commit", "-m", "i"], repo);
    const r = await applyWorktreeMerge(repo, repo);
    assert.equal(r.ok, true);
    assert.equal(r.code, MERGE_ERROR_CODES.SAME_TREE);
  });

  it("verify still excluded from candidates (no false conflict)", () => {
    const c = collectMergeCandidates([
      { ok: true, role: "verify", nodeId: "v", workspace: "/tmp/main" },
    ]);
    assert.equal(c.length, 0);
  });
});
