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

// 2026-08-23 soak night 1 regression: two campaign jobs completed verified
// work but omitted the structured claims block; the gate refused and the
// retry loop demanded !refuse, so the budget sat unused and the jobs
// hard-failed. The retry must fire on a refusing gate, stay bounded, and
// heal only when the restated claims ground in real evidence.
describe("soft retry fires on a refusing gate (soak night-1 fix)", () => {
  const toolEvidence = [
    { id: "ev_1", source: "tool", summary: "bash: node src/run.js -> RESULT=4" },
    { id: "ev_2", source: "tool", summary: "write_file: src/calc.js" },
  ];
  const mkEvidence = () => ({
    snapshot: () => toolEvidence,
    add() {},
    fromToolTrace() {},
  });
  const refuseOpts = { groundHard: true, requireStructuredClaims: true, goal: "fix the bug" };

  it("missing-block refusal triggers one retry and heals on an honest restate", async () => {
    let rescues = 0;
    const r = await runClaimsGateWithSoftRetry({
      agentResult: { text: "Fixed src/calc.js. node src/run.js prints RESULT=4.", toolTrace: [] },
      evidence: mkEvidence(),
      cfg: { profile: "lab", jobs: {} },
      opts: refuseOpts,
      push() {},
      runAgentLoop: async (o) => {
        rescues += 1;
        assert.match(String(o.userMessage), /structured block/);
        return {
          text:
            'Fixed src/calc.js; node src/run.js prints RESULT=4.\n```json\n{"claims":["fixed src/calc.js so run.js prints RESULT=4"],"evidence_ids":["ev_1","ev_2"]}\n```',
          toolTrace: [],
          turns: 1,
        };
      },
    });
    assert.equal(rescues, 1);
    assert.equal(r.groundingFailed, false);
    assert.equal(r.error, null);
    assert.equal(r.softRetryBudget.used, 1);
  });

  it("a restate that still omits the block stays failed and bounded", async () => {
    let rescues = 0;
    const r = await runClaimsGateWithSoftRetry({
      agentResult: { text: "Done.", toolTrace: [] },
      evidence: mkEvidence(),
      cfg: { profile: "lab", jobs: {} },
      opts: refuseOpts,
      push() {},
      runAgentLoop: async () => {
        rescues += 1;
        return { text: "Still no block.", toolTrace: [], turns: 1 };
      },
    });
    assert.equal(rescues, 1); // default budget max 1 — bounded
    assert.equal(r.groundingFailed, true);
    assert.equal(r.softRetryBudget.used, 1);
    assert.equal(r.softRetryBudget.remaining, 0);
  });

  it("a restate claiming an untouched path is still refused (no fabrication laundering)", async () => {
    const r = await runClaimsGateWithSoftRetry({
      agentResult: { text: "Fixed things.", toolTrace: [] },
      evidence: mkEvidence(),
      cfg: { profile: "lab", jobs: {} },
      opts: refuseOpts,
      push() {},
      runAgentLoop: async () => ({
        text: 'Done.\n```json\n{"claims":["rewrote src/secret.js"],"evidence_ids":["ev_9"]}\n```',
        toolTrace: [],
        turns: 1,
      }),
    });
    assert.equal(r.groundingFailed, true);
  });
});

// Root cause of soak nights 1–2: the loop strips the claims block from its
// presentation `text`; the gate must score the raw `finalText` instead of
// failing the model for the runtime's own strip.
describe("gate scores raw finalText, not the stripped presentation text", () => {
  const toolEv = [
    { id: "ev_1", source: "tool", summary: "bash: node src/run.js -> RESULT=4" },
    { id: "ev_2", source: "tool", summary: "write_file: src/calc.js" },
  ];
  it("a compliant answer whose block was stripped from `text` passes without any rescue", async () => {
    let rescues = 0;
    const r = await runClaimsGateWithSoftRetry({
      agentResult: {
        text: "Fixed src/calc.js; node src/run.js prints RESULT=4.",
        finalText:
          'Fixed src/calc.js; node src/run.js prints RESULT=4.\n```json\n{"claims":["fixed src/calc.js so run.js prints RESULT=4"],"evidence_ids":["ev_1","ev_2"]}\n```',
        toolTrace: [],
      },
      evidence: { snapshot: () => toolEv, add() {}, fromToolTrace() {} },
      cfg: { profile: "lab", jobs: {} },
      opts: { groundHard: true, requireStructuredClaims: true, goal: "fix" },
      push() {},
      runAgentLoop: async () => {
        rescues += 1;
        return { text: "unused", toolTrace: [], turns: 1 };
      },
    });
    assert.equal(rescues, 0);
    assert.equal(r.groundingFailed, false);
    assert.equal(r.error, null);
  });

  it("rescue re-gates on the rescue's raw finalText", async () => {
    const r = await runClaimsGateWithSoftRetry({
      agentResult: { text: "Fixed src/calc.js.", toolTrace: [] },
      evidence: { snapshot: () => toolEv, add() {}, fromToolTrace() {} },
      cfg: { profile: "lab", jobs: {} },
      opts: { groundHard: true, requireStructuredClaims: true, goal: "fix" },
      push() {},
      runAgentLoop: async () => ({
        text: "Fixed src/calc.js; node src/run.js prints RESULT=4.", // stripped
        finalText:
          'Fixed src/calc.js; node src/run.js prints RESULT=4.\n```json\n{"claims":["fixed src/calc.js so run.js prints RESULT=4"],"evidence_ids":["ev_1","ev_2"]}\n```',
        toolTrace: [],
        turns: 1,
      }),
    });
    assert.equal(r.groundingFailed, false);
    assert.equal(r.softRetryBudget.used, 1);
  });
});
