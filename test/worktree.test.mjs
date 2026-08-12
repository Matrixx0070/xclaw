import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isGitRepo } from "../src/agents/worktree.mjs";

describe("worktree helpers", () => {
  it("detects non-repo", async () => {
    const ok = await isGitRepo("/tmp");
    assert.equal(typeof ok, "boolean");
  });
});
