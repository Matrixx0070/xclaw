import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCriticVerdict, evaluateMergeGates } from "../src/agents/swarm-merge.mjs";

const POLICY = { requireVerify: false, requireCriticPass: true };
const impl = { nodeId: "impl", role: "implement", ok: true };
const critic = (text, ok = true) => ({ nodeId: "c1", role: "critic", ok, text });

describe("parseCriticVerdict", () => {
  it("parses a bare JSON line", () => {
    const v = parseCriticVerdict(
      'Looks risky.\n{"verdict":"block","confidence":0.9,"reasons":["no tests"]}'
    );
    assert.equal(v.verdict, "block");
    assert.equal(v.confidence, 0.9);
    assert.deepEqual(v.reasons, ["no tests"]);
  });

  it("parses a fenced json block", () => {
    const v = parseCriticVerdict(
      'Review done.\n```json\n{"verdict":"approve","confidence":0.8,"reasons":[]}\n```\n'
    );
    assert.equal(v.verdict, "approve");
  });

  it("parses an object embedded in prose", () => {
    const v = parseCriticVerdict(
      'My assessment {"verdict":"approve","reasons":["solid"]} stands.'
    );
    assert.equal(v.verdict, "approve");
    assert.deepEqual(v.reasons, ["solid"]);
  });

  it("last verdict wins when multiple objects appear", () => {
    const v = parseCriticVerdict(
      '{"verdict":"block","reasons":["draft thinking"]}\nOn reflection the fix is fine.\n{"verdict":"approve","confidence":1}'
    );
    assert.equal(v.verdict, "approve");
  });

  it("returns null for malformed JSON, no verdict key, or bad verdict values", () => {
    assert.equal(parseCriticVerdict('{"verdict":"block",,}'), null);
    assert.equal(parseCriticVerdict("prose with the word block only"), null);
    assert.equal(parseCriticVerdict('{"verdict":"maybe"}'), null);
    assert.equal(parseCriticVerdict(""), null);
    assert.equal(parseCriticVerdict(null), null);
  });

  it("clamps confidence and tolerates a missing one", () => {
    assert.equal(parseCriticVerdict('{"verdict":"block","confidence":7}').confidence, 1);
    assert.equal(parseCriticVerdict('{"verdict":"block"}').confidence, null);
  });

  it("handles braces inside strings", () => {
    const v = parseCriticVerdict('{"verdict":"block","reasons":["bad {config} shape"]}');
    assert.equal(v.verdict, "block");
    assert.deepEqual(v.reasons, ["bad {config} shape"]);
  });
});

describe("critic merge gate — structured verdict decides", () => {
  it("structured block blocks the merge", () => {
    const g = evaluateMergeGates(
      [impl, critic('All fine except one thing.\n{"verdict":"block","reasons":["secret in diff"]}')],
      POLICY
    );
    assert.equal(g.ok, false);
    assert.match(g.reasons.join(" "), /structured/);
    assert.match(g.reasons.join(" "), /secret in diff/);
  });

  it("structured approve does NOT block even when prose contains keyword triggers", () => {
    // The review's exact false-positive: prose says "I would not reject this"
    const g = evaluateMergeGates(
      [
        impl,
        critic(
          'I would not reject this. Nothing blocking, no critical risk.\n{"verdict":"approve","confidence":0.85,"reasons":[]}'
        ),
      ],
      POLICY
    );
    assert.equal(g.ok, true, `reasons: ${g.reasons.join("; ")}`);
  });

  it("no parseable verdict falls back to keyword semantics (legacy behavior)", () => {
    const blocked = evaluateMergeGates(
      [impl, critic("This is a blocking issue — do not merge")],
      POLICY
    );
    assert.equal(blocked.ok, false);
    assert.match(blocked.reasons.join(" "), /keyword-fallback/);

    const fine = evaluateMergeGates([impl, critic("Looks good, ship it")], POLICY);
    assert.equal(fine.ok, true);
  });

  it("malformed JSON falls back to keywords", () => {
    const g = evaluateMergeGates(
      [impl, critic('{"verdict":"approve",,,}\nSeriously, do not merge this.')],
      POLICY
    );
    assert.equal(g.ok, false);
    assert.match(g.reasons.join(" "), /keyword-fallback/);
  });

  it("failed critic node still blocks regardless of text", () => {
    const g = evaluateMergeGates(
      [impl, critic('{"verdict":"approve"}', false)],
      POLICY
    );
    assert.equal(g.ok, false);
  });
});
