import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyWorktreeMerge } from "../src/agents/worktree.mjs";

describe("worktree merge", () => {
  it("fails on non-git", async () => {
    const r = await applyWorktreeMerge("/tmp", "/tmp");
    assert.equal(r.ok, false);
  });
});
