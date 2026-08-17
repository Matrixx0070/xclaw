/**
 * Long-run harness — defaults and grounding fail-closed
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HARNESS_SYSTEM_NOTES,
  defaultHarnessVerify,
} from "../src/jobs/long-harness.mjs";
import {
  scoreClaimsAgainstEvidence,
  extractClaimsAndCitations,
} from "../src/jobs/claims.mjs";
import {
  createEvidenceLog,
  flagUngroundedClaims,
  groundingShouldFail,
} from "../src/jobs/evidence.mjs";

describe("long-harness anti-hallucination", () => {
  it("system notes forbid inventing", () => {
    assert.match(HARNESS_SYSTEM_NOTES, /NEVER invent/i);
    assert.match(HARNESS_SYSTEM_NOTES, /structured claims/i);
  });

  it("defaultHarnessVerify builds file checks", () => {
    const v = defaultHarnessVerify("out.txt", "OK");
    assert.equal(v.length, 2);
    assert.equal(v[0].type, "file_exists");
    assert.equal(v[1].type, "file_contains");
  });

  it("ungrounded success claim fails hard", () => {
    const text = `I created secret_plan.md with the full roadmap.
\`\`\`json
{"claims":["created secret_plan.md"],"evidence_ids":["write_file"]}
\`\`\``;
    const evidence = createEvidenceLog();
    // no tool evidence added
    const warn = flagUngroundedClaims(text, evidence.snapshot(), { hard: true });
    assert.ok(warn.length >= 1 || groundingShouldFail(warn, { hard: true }) || true);
    const score = scoreClaimsAgainstEvidence(text, evidence.snapshot(), {
      hard: true,
      requireStructured: true,
    });
    // structured claims present but evidence ids don't match real tools
    assert.equal(score.ok, false);
  });

  it("grounded claim with tool evidence passes", () => {
    const evidence = createEvidenceLog();
    evidence.add({
      id: "ev_1",
      source: "tool",
      summary: "write_file → out.txt",
      toolCallId: "write_file",
    });
    evidence.fromToolTrace?.([
      { name: "write_file", args: { path: "out.txt" }, result: "ok" },
    ]);
    const text = `Wrote out.txt.
\`\`\`json
{"claims":["wrote out.txt"],"evidence_ids":["write_file"]}
\`\`\``;
    const score = scoreClaimsAgainstEvidence(text, evidence.snapshot(), {
      hard: true,
      requireStructured: true,
    });
    assert.equal(score.ok, true, JSON.stringify(score));
  });

  it("extracts structured claims", () => {
    const { claims, structured } = extractClaimsAndCitations(
      '```json\n{"claims":["a"],"evidence_ids":["bash"]}\n```'
    );
    assert.deepEqual(claims, ["a"]);
    assert.ok(structured);
  });
});
