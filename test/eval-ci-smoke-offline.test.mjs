/**
 * Eval CI smoke offline: cases load; mock path is structured and non-throwing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadCases, runEvalSuite } from "../src/eval/runner.mjs";

describe("eval CI smoke offline", () => {
  it("loads tag=smoke cases", async () => {
    const cases = await loadCases({ tag: "smoke" });
    assert.ok(cases.length >= 1, "expected at least one smoke case");
    for (const c of cases) {
      assert.ok(c.id, "case id");
      assert.ok(c.prompt || c.name, "case prompt/name");
    }
  });

  it("mock suite returns report with mock flags and exit-safe shape", async () => {
    const report = await runEvalSuite({
      cfg: { security: { autoApprove: true }, agent: { maxTurns: 2 } },
      tag: "smoke",
      mock: true,
    });
    assert.ok(report.total >= 1);
    assert.ok(Array.isArray(report.results));
    assert.ok(report.results.every((r) => r.mock === true));
    assert.equal(typeof report.passRate, "number");
    assert.equal(typeof report.failed, "number");
  });
});
