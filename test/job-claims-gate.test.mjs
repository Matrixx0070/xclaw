/**
 * Job path uses claims-gate refuse semantics.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gateStructuredClaims } from "../src/agent/claims-gate.mjs";
import { buildJobSystemNotes } from "../src/jobs/job.mjs";

describe("job claims-gate contract", () => {
  it("refuse ungrounded hard claims", () => {
    const g = gateStructuredClaims({
      text: 'I created the file.\n```json\n{"claims":["created x"],"evidence_ids":[]}\n```',
      evidence: [],
      cfg: { jobs: { groundHard: true, claimsRequireEvidence: true } },
      opts: { groundHard: true, claimsRequireEvidence: true },
    });
    assert.equal(g.refuse, true);
  });

  it("pass with tool evidence", () => {
    const g = gateStructuredClaims({
      text: 'Done.\n```json\n{"claims":["wrote f"],"evidence_ids":["xclaw_file_write"]}\n```',
      evidence: [{ source: "tool", id: "xclaw_file_write", summary: "xclaw_file_write → ok" }],
      cfg: {},
      opts: { groundHard: true, claimsRequireEvidence: true },
    });
    assert.equal(g.refuse, false);
  });
});

// Fix 2 of the 2026-08-23 soak night-1 regression: the base prompt only says
// to PREFER the claims block; a job whose policy hard-requires the block must
// TELL the model it is mandatory via systemNotes.
describe("buildJobSystemNotes claims requirement injection", () => {
  it("appends the mandatory-claims note when the policy requires structured claims", () => {
    const notes = buildJobSystemNotes(
      { requireStructuredClaims: true },
      { agent: {} },
      { profile: "lab", jobs: {} }
    );
    assert.equal(notes.length, 1);
    assert.match(notes[0], /MANDATORY/);
    assert.match(notes[0], /claims/);
  });

  it("no note when structured claims are explicitly not required", () => {
    const off = { requireStructuredClaims: false, claimsRequireEvidence: false, groundHard: false };
    const notes = buildJobSystemNotes(off, { agent: {} }, { profile: "lab", jobs: {} });
    assert.deepEqual(notes, []);
  });

  it("preserves caller systemNotes (string and array) and appends after them", () => {
    const a = buildJobSystemNotes(
      { requireStructuredClaims: true, systemNotes: "keep me" },
      { agent: {} },
      { jobs: {} }
    );
    assert.equal(a[0], "keep me");
    assert.match(a[1], /MANDATORY/);
    const b = buildJobSystemNotes(
      {
        systemNotes: ["one", "two"],
        requireStructuredClaims: false,
        claimsRequireEvidence: false,
        groundHard: false,
      },
      { agent: {} },
      { jobs: {} }
    );
    assert.deepEqual(b, ["one", "two"]);
  });
});
