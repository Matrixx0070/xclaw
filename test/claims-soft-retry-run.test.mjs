import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runClaimsGateWithSoftRetry,
  stampJobClaimsSoftRetry,
} from "../src/jobs/claims-soft-retry-run.mjs";

describe("claims soft-retry run", () => {
  it("stamps budget on pass without retry when soft disabled", async () => {
    const evidence = {
      snapshot: () => [{ id: "e1", source: "tool", summary: "ok" }],
      add() {},
    };
    const r = await runClaimsGateWithSoftRetry({
      agentResult: {
        text: 'ok\n```json\n{"claims":[{"text":"ok","evidence_ids":["e1"]}]}\n```',
        toolTrace: [{ name: "bash", status: "ok" }],
      },
      evidence,
      cfg: {
        profile: "lab",
        jobs: {
          claimsSoftRetry: false,
          groundHard: false,
          claimsRequireEvidence: false,
          requireStructuredClaims: false,
        },
      },
      opts: {
        groundHard: false,
        claimsRequireEvidence: false,
        requireStructuredClaims: false,
        claimsSoftRetry: false,
      },
      push() {},
    });
    assert.ok(r.softRetryBudget);
    assert.equal(r.softRetryBudget.used, 0);
    const job = { id: "j" };
    stampJobClaimsSoftRetry(job, r.softRetryBudget, r.claimsGate);
    assert.equal(job.claimsSoftRetry.used, 0);
    assert.ok(job.claimsGate);
  });

  it("budget max limits retries", async () => {
    const evidence = {
      items: [],
      snapshot() {
        return this.items;
      },
      add(x) {
        this.items.push(x);
      },
      fromToolTrace() {},
    };
    let loops = 0;
    const r = await runClaimsGateWithSoftRetry({
      agentResult: { text: "bare answer with no evidence", toolTrace: [] },
      evidence,
      cfg: {
        jobs: {
          claimsSoftRetryMax: 1,
          groundHard: false,
          claimsRequireEvidence: false,
        },
      },
      opts: {
        groundHard: false,
        claimsRequireEvidence: false,
        claimsSoftRetryMax: 1,
        goal: "g",
      },
      push() {},
      runAgentLoop: async () => {
        loops += 1;
        return { text: "still bare", toolTrace: [], turns: 1 };
      },
    });
    assert.ok(r.softRetryBudget.max >= 1);
    assert.ok(r.softRetryBudget.used <= r.softRetryBudget.max);
    assert.ok(loops <= r.softRetryBudget.max);
  });
});
