import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreAutonomyRun, aggregateAutonomy } from "../src/eval/autonomy-metrics.mjs";

describe("A4 autonomy metrics", () => {
  it("flags zero-tool handoff", () => {
    const s = scoreAutonomyRun({
      text: "Please paste the endpoint URL for me.",
      toolTrace: [],
    });
    assert.equal(s.handoff, true);
    assert.equal(s.zeroToolHandoff, true);
    assert.equal(s.toolFirst, false);
  });

  it("tool use without handoff is toolFirst", () => {
    const s = scoreAutonomyRun({
      text: "Wrote the file and verified contents.",
      toolTrace: [{ name: "xclaw_bash", status: "ok" }],
    });
    assert.equal(s.toolFirst, true);
    assert.equal(s.handoff, false);
  });

  it("aggregate rates", () => {
    const a = aggregateAutonomy([
      { completion: true, handoff: false, toolFirst: true, zeroToolHandoff: false, toolCount: 2 },
      { completion: false, handoff: true, toolFirst: false, zeroToolHandoff: true, toolCount: 0 },
    ]);
    assert.equal(a.n, 2);
    assert.equal(a.completion, 0.5);
    assert.equal(a.handoffRate, 0.5);
  });

  it("includes quota escalate in scorecard", () => {
    const s = scoreAutonomyRun({
      text: "done",
      toolTrace: [{ name: "bash" }],
      quotaEscalate: { hardBlocks: 2, softWarns: 1 },
    });
    assert.equal(s.hardBlocks, 2);
    assert.equal(s.quotaHard, true);
    const a = aggregateAutonomy([s, { hardBlocks: 0, softWarns: 0, quotaHard: false }]);
    assert.equal(a.hardBlocks, 2);
    assert.equal(a.hardBlockRate, 1);
    assert.equal(a.quotaHardRate, 0.5);
  });
});
