import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inspectGitWorktree,
  buildCommitChipPrompt,
} from "../src/agent/git-status.mjs";
import { buildTurnSuggestions } from "../src/agent/suggestions.mjs";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";

describe("git-status", () => {
  it("inspect non-repo", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-nongit-"));
    const g = inspectGitWorktree(tmp);
    assert.equal(g.isRepo, false);
    assert.equal(g.dirty, false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("inspect dirty repo", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-git-"));
    spawnSync("git", ["init"], { cwd: tmp, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "t@test"], { cwd: tmp });
    spawnSync("git", ["config", "user.name", "t"], { cwd: tmp });
    fs.writeFileSync(path.join(tmp, "a.txt"), "hello");
    const g = inspectGitWorktree(tmp);
    assert.equal(g.isRepo, true);
    assert.equal(g.dirty, true);
    assert.ok(g.fileCount >= 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("buildCommitChipPrompt lists files", () => {
    const p = buildCommitChipPrompt(
      { samplePaths: ["src/a.mjs"] },
      [{ artifacts: [{ type: "file", ref: "src/b.mjs" }] }]
    );
    assert.match(p, /src\/a\.mjs/);
    assert.match(p, /commit/i);
  });
});

describe("commit chip path", () => {
  const closedCtx = {
    userMessage: "Implement feature X",
    replyText: "Done. Implemented and all tests pass.",
    toolTrace: [
      {
        name: "xclaw_file_write",
        status: "ok",
        outcome: { kind: "success", summary: "ok", confidence: 1 },
        artifacts: [{ type: "file", ref: "src/x.mjs", role: "output" }],
      },
    ],
  };

  it("no chip when closed and clean", () => {
    const items = buildTurnSuggestions({
      ...closedCtx,
      git: { isRepo: true, dirty: false, fileCount: 0, samplePaths: [] },
      cfg: {
        suggestions: {
          suppressOnClose: true,
          closureMinConfidence: 0.6,
          closedAllowCommitChip: "auto",
          skipGitInspect: true,
        },
      },
    });
    assert.equal(items.length, 0);
  });

  it("commit chip when closed and dirty", () => {
    const items = buildTurnSuggestions({
      ...closedCtx,
      git: {
        isRepo: true,
        dirty: true,
        fileCount: 2,
        samplePaths: ["src/x.mjs", "test/x.test.mjs"],
        branch: "main",
      },
      cfg: {
        suggestions: {
          suppressOnClose: true,
          closureMinConfidence: 0.6,
          closedAllowCommitChip: "auto",
          skipGitInspect: true,
        },
      },
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, "commit");
    assert.match(items[0].label, /Commit 2/);
    assert.match(items[0].prompt, /src\/x\.mjs/);
  });

  it("force commit chip even if clean when true", () => {
    const items = buildTurnSuggestions({
      ...closedCtx,
      git: { isRepo: true, dirty: false, fileCount: 0 },
      cfg: {
        suggestions: {
          closedAllowCommitChip: true,
          suppressOnClose: true,
          closureMinConfidence: 0.6,
          skipGitInspect: true,
        },
      },
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, "commit");
  });

  it("disabled never shows commit chip", () => {
    const items = buildTurnSuggestions({
      ...closedCtx,
      git: { isRepo: true, dirty: true, fileCount: 3, samplePaths: ["a"] },
      cfg: {
        suggestions: {
          closedAllowCommitChip: false,
          suppressOnClose: true,
          closureMinConfidence: 0.6,
          skipGitInspect: true,
        },
      },
    });
    assert.equal(items.length, 0);
  });
});
