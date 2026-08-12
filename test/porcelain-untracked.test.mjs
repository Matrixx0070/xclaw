import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parsePorcelainUntracked,
  unquoteGitCStylePath,
} from "../src/agents/worktree.mjs";

describe("git porcelain untracked detection", () => {
  it("parses simple untracked", () => {
    assert.deepEqual(parsePorcelainUntracked("?? untracked.txt\n"), [
      "untracked.txt",
    ]);
  });

  it("parses directory entries and strips trailing slash", () => {
    assert.deepEqual(parsePorcelainUntracked("?? nested/\n?? live-swarm-demo/\n"), [
      "nested",
      "live-swarm-demo",
    ]);
  });

  it("unquotes C-style paths with spaces", () => {
    const lines = '?? "dir with spaces/sub/a.txt"\n';
    assert.deepEqual(parsePorcelainUntracked(lines), [
      "dir with spaces/sub/a.txt",
    ]);
  });

  it("unquotes escaped quote and tab", () => {
    assert.equal(unquoteGitCStylePath('"quote\\"file.txt"'), 'quote"file.txt');
    assert.equal(unquoteGitCStylePath('"weird\\tname.txt"'), "weird\tname.txt");
  });

  it("ignores tracked modifications", () => {
    const lines = [
      " M README",
      "AM added.txt",
      "?? only-new.txt",
      "?? nested/deep/f.txt",
    ].join("\n");
    assert.deepEqual(parsePorcelainUntracked(lines), [
      "only-new.txt",
      "nested/deep/f.txt",
    ]);
  });

  it("handles empty / whitespace", () => {
    assert.deepEqual(parsePorcelainUntracked(""), []);
    assert.deepEqual(parsePorcelainUntracked("\n\n"), []);
  });
});
