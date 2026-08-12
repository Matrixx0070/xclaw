
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeSkillDelta } from "../src/skills/loop.mjs";

describe("skill AB delta", () => {
  it("helped on fail then pass", () => {
    const d = computeSkillDelta({ pass: false, turns: 8 }, { pass: true, turns: 5 });
    assert.equal(d.helped, true);
  });
  it("not helped if still fail", () => {
    const d = computeSkillDelta({ pass: false, turns: 8 }, { pass: false, turns: 9 });
    assert.equal(d.helped, false);
  });
});
