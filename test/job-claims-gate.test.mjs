/**
 * Job path uses claims-gate refuse semantics.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gateStructuredClaims } from "../src/agent/claims-gate.mjs";

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
