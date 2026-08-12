import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractStructuredBallot,
  tallyField,
  structuredMajorityVote,
  formatVoteReport,
} from "../src/agents/swarm-vote.mjs";

describe("extractStructuredBallot", () => {
  it("parses fenced json", () => {
    const o = extractStructuredBallot(
      'Hello\n```json\n{"label":"yes","confidence":0.8}\n```\n'
    );
    assert.equal(o.label, "yes");
    assert.equal(o.confidence, 0.8);
  });

  it("returns null without json", () => {
    assert.equal(extractStructuredBallot("no structure here"), null);
  });
});

describe("tallyField", () => {
  it("majority wins", () => {
    const t = tallyField(["yes", "yes", "no"]);
    assert.equal(t.winner, "yes");
    assert.equal(t.count, 2);
    assert.equal(t.tie, false);
  });

  it("detects unbroken tie", () => {
    const t = tallyField(["a", "b"], { tieBreak: "none" });
    assert.equal(t.tie, true);
    assert.equal(t.winner, null);
  });

  it("breaks tie with first", () => {
    const t = tallyField(["a", "b"], { tieBreak: "first" });
    assert.equal(t.tiedBroken, true);
    assert.equal(t.winner, "a");
  });

  it("breaks tie with lexical", () => {
    const t = tallyField(["z", "a"], { tieBreak: "lexical" });
    assert.equal(t.winner, "a");
  });

  it("breaks tie with confidence", () => {
    const t = tallyField(["x", "y"], {
      tieBreak: "confidence",
      confidences: [0.4, 0.9],
    });
    assert.equal(t.winner, "y");
    assert.equal(t.tieBreakMethod, "confidence");
  });

  it("breaks tie with prefer", () => {
    const t = tallyField(["no", "yes"], {
      tieBreak: "prefer",
      preferValue: "yes",
    });
    assert.equal(t.winner, "yes");
  });
});

describe("structuredMajorityVote", () => {
  it("builds consensus across research nodes", () => {
    const results = [
      {
        nodeId: "r1",
        role: "research",
        ok: true,
        text: '```json\n{"label":"buy","risk":"low"}\n```',
      },
      {
        nodeId: "r2",
        role: "research",
        ok: true,
        text: '```json\n{"label":"buy","risk":"med"}\n```',
      },
      {
        nodeId: "r3",
        role: "research",
        ok: true,
        text: '```json\n{"label":"buy","risk":"low"}\n```',
      },
    ];
    const v = structuredMajorityVote(results);
    assert.equal(v.validBallots, 3);
    assert.equal(v.consensus.label, "buy");
    assert.equal(v.consensus.risk, "low");
    assert.equal(v.fields.label.consensus, true);
    assert.ok(formatVoteReport(v).includes("CONSENSUS"));
  });

  it("ignores non-research by default", () => {
    const v = structuredMajorityVote([
      {
        nodeId: "i1",
        role: "implement",
        ok: true,
        text: '```json\n{"label":"x"}\n```',
      },
    ]);
    assert.equal(v.validBallots, 0);
  });
});
