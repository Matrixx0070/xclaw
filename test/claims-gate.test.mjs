/**
 * Structured claims gate — refuse ungrounded factual claims when hard.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveClaimsPolicy,
  gateStructuredClaims,
  applyClaimsGateToResult,
} from "../src/agent/claims-gate.mjs";
import { parseStructuredClaims } from "../src/jobs/claims.mjs";

describe("claims policy", () => {
  it("prod profile forces hard claims", () => {
    const p = resolveClaimsPolicy({ profile: "prod", jobs: { groundHard: true } });
    assert.equal(p.hard, true);
  });

  it("lab soft by default unless jobs set", () => {
    const p = resolveClaimsPolicy({ profile: "lab" });
    assert.ok(typeof p.hard === "boolean");
  });
});

describe("gateStructuredClaims", () => {
  it("refuses hard claims without tools", () => {
    const text = `I wrote the file successfully.\n\`\`\`json\n{"claims":["I wrote foo.txt"],"evidence_ids":[]}\n\`\`\``;
    const g = gateStructuredClaims({
      text,
      evidence: [],
      cfg: { jobs: { groundHard: true, claimsRequireEvidence: true } },
      opts: { groundHard: true, claimsRequireEvidence: true },
    });
    assert.equal(g.refuse, true);
    assert.ok(g.warnings.length >= 1);
  });

  it("passes when tool evidence backs claim", () => {
    const text = `Done.\n\`\`\`json\n{"claims":["wrote a4-hello.txt"],"evidence_ids":["xclaw_file_write"]}\n\`\`\``;
    const evidence = [
      {
        source: "tool",
        id: "xclaw_file_write",
        summary: "xclaw_file_write → ok wrote a4-hello.txt",
      },
    ];
    const g = gateStructuredClaims({
      text,
      evidence,
      cfg: {},
      opts: { groundHard: true, claimsRequireEvidence: true },
    });
    assert.equal(g.refuse, false, JSON.stringify(g.warnings));
    assert.equal(g.ok, true);
  });

  it("parses bare trailing claims JSON", () => {
    const text = 'All set.\n{"claims":["x"],"evidence_ids":["t1"]}';
    const s = parseStructuredClaims(text);
    assert.ok(s);
    assert.deepEqual(s.claims, ["x"]);
    assert.deepEqual(s.evidence_ids, ["t1"]);
  });
});

describe("applyClaimsGateToResult", () => {
  it("marks failed on refuse", () => {
    const r = applyClaimsGateToResult(
      { ok: true, text: "I created the file.", status: "succeeded" },
      {
        evidence: [],
        cfg: { jobs: { groundHard: true } },
        opts: { groundHard: true },
      }
    );
    assert.equal(r.status, "failed");
    assert.equal(r.ok, false);
    assert.ok(r.claimsGate.refuse);
  });
});
