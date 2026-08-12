
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractClaimsAndCitations,
  scoreClaimsAgainstEvidence,
} from "../src/jobs/claims.mjs";

describe("claim evidence v2", () => {
  it("extracts citations", () => {
    const { citations, claims } = extractClaimsAndCitations(
      "I wrote foo [ev:ev_1] (tool:bash). LINES=4"
    );
    assert.ok(citations.includes("ev_1"));
    assert.ok(claims.length >= 1);
  });
  it("fails hard without tools", () => {
    const r = scoreClaimsAgainstEvidence("I created the file x.", [], { hard: true });
    assert.equal(r.ok, false);
  });
  it("passes with tool evidence", () => {
    const r = scoreClaimsAgainstEvidence("I created the file.", [
      { id: "ev_1", source: "tool", summary: "write → ok" },
    ], { hard: true });
    assert.equal(r.ok, true);
  });
});
