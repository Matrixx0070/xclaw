import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseStructuredClaims,
  scoreClaimsAgainstEvidence,
} from "../src/jobs/claims.mjs";
import { computeSkillDelta } from "../src/skills/loop.mjs";

describe("structured claims", () => {
  it("parses json block", () => {
    const s = parseStructuredClaims(
      'Done.\n```json\n{"claims":["fixed auth"],"evidence_ids":["ev_1"]}\n```'
    );
    assert.deepEqual(s.claims, ["fixed auth"]);
    assert.ok(s.evidence_ids.includes("ev_1"));
  });
  it("requireStructured fails without block", () => {
    const r = scoreClaimsAgainstEvidence("I fixed it", [{ source: "tool", id: "ev_1", summary: "x" }], {
      requireStructured: true,
      hard: true,
    });
    assert.equal(r.ok, false);
  });
});

describe("skill delta", () => {
  it("detects help", () => {
    const d = computeSkillDelta({ pass: false, turns: 10 }, { pass: true, turns: 4 });
    assert.equal(d.helped, true);
    assert.equal(d.turnDelta, -6);
  });
});
