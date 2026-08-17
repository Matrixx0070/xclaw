import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractClaimPaths,
  extractEvidencePaths,
  scoreClaimsAgainstEvidence,
} from "../src/jobs/claims.mjs";

describe("path binding", () => {
  it("extracts paths from claims", () => {
    const p = extractClaimPaths('I wrote notes/hello.txt successfully');
    assert.ok(p.some((x) => x.includes("hello.txt")));
  });

  it("flags path not in evidence under hard", () => {
    const r = scoreClaimsAgainstEvidence(
      'I wrote secrets/passwords.txt with the vault key.',
      [{ id: "ev_1", source: "tool", summary: "write_file → notes/other.md ok" }],
      { hard: true }
    );
    assert.equal(r.ok, false);
    assert.ok(r.warnings.some((w) => /path not in tool evidence/i.test(w)));
  });

  it("passes when path appears in evidence", () => {
    const r = scoreClaimsAgainstEvidence(
      'I wrote notes/hello.txt.\n```json\n{"claims":["wrote notes/hello.txt"],"evidence_ids":["write_file"]}\n```',
      [{ id: "ev_1", source: "tool", summary: "write_file → notes/hello.txt written" }],
      { hard: true, requireStructured: true }
    );
    assert.equal(r.unboundPaths.length, 0);
  });
});
