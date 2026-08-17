import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUTONOMOUS_PRINCIPLES,
  principlesForLevel,
  applyPrinciplesToHarnessOpts,
  PRINCIPLES_VERSION,
} from "../src/agent/principles.mjs";

describe("autonomous principles", () => {
  it("axioms present", () => {
    assert.match(AUTONOMOUS_PRINCIPLES, /Grounding/i);
    assert.match(AUTONOMOUS_PRINCIPLES, /Fail closed/i);
    assert.match(AUTONOMOUS_PRINCIPLES, /Killable/i);
  });

  it("full level is strict ground", () => {
    const p = principlesForLevel("full");
    assert.equal(p.groundHard, true);
    assert.equal(p.claimsRequireEvidence, true);
    assert.ok(p.checkpointEveryTurns >= 2);
  });

  it("supervised requires structured claims", () => {
    const p = principlesForLevel("supervised");
    assert.equal(p.requireStructuredClaims, true);
  });

  it("applyPrinciples merges opts win", () => {
    const o = applyPrinciplesToHarnessOpts(
      { groundHard: false, systemNotes: ["extra"] },
      "full"
    );
    assert.equal(o.groundHard, false);
    assert.ok(o.systemNotes.some((n) => /extra/.test(n)));
    assert.ok(o.systemNotes.some((n) => /Autonomous agent principles/i.test(n)));
  });

  it("version", () => {
    assert.equal(PRINCIPLES_VERSION, 1);
  });
});
