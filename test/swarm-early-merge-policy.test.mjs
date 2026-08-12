import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeImplementNodeEarly } from "../src/agents/swarm-run.mjs";
import { resolveMergePolicy } from "../src/agents/swarm-merge.mjs";

describe("swarm early-merge policy (P0)", () => {
  it("resolveMergePolicy: prod defaults autoMerge false", () => {
    const p = resolveMergePolicy({ profile: "prod", swarm: {} }, {});
    assert.equal(p.autoMerge, false);
  });

  it("mergeImplementNodeEarly skips when prod and autoMerge off", async () => {
    const cfg = { profile: "prod", swarm: { autoMerge: false, earlyMergeImplement: false } };
    const result = {
      ok: true,
      role: "implement",
      nodeId: "n1",
      workspace: "/tmp/xclaw-wt-does-not-need-to-exist-for-skip",
    };
    const out = await mergeImplementNodeEarly(cfg, result, {
      workingDir: process.cwd(),
      autoMerge: false,
    });
    assert.ok(out);
    assert.equal(out.skipped, true);
    assert.equal(out.method, "autoMerge-off");
  });

  it("mergeImplementNodeEarly does not force policy autoMerge true", async () => {
    const cfg = { profile: "prod", swarm: { autoMerge: false } };
    // If forced autoMerge:true were still present, skip would not happen
    const out = await mergeImplementNodeEarly(
      cfg,
      {
        ok: true,
        role: "implement",
        nodeId: "n2",
        workspace: "/tmp/xclaw-wt-skip-2",
      },
      { workingDir: process.cwd() }
    );
    assert.equal(out?.skipped, true);
  });
});
