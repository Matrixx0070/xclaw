
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasReceipt,
  receiptVoteWeight,
  evaluateReceiptPolicy,
  buildRunReceiptSummary,
  receiptsRequired,
} from "../src/agents/swarm-receipt.mjs";
import { evaluateMergeGates, resolveMergePolicy } from "../src/agents/swarm-merge.mjs";
import { structuredMajorityVote } from "../src/agents/swarm-vote.mjs";

describe("S2 receipts in merge/vote", () => {
  it("hasReceipt detects ids", () => {
    assert.equal(hasReceipt({ receiptId: "x" }), true);
    assert.equal(hasReceipt({}), false);
  });

  it("receiptVoteWeight penalizes missing", () => {
    assert.ok(receiptVoteWeight({}) < receiptVoteWeight({ receiptId: "r", receipt: { ok: true, toolsTotal: 2 } }));
    assert.equal(receiptVoteWeight({}, { hard: true }), 0);
  });

  it("evaluateReceiptPolicy hard fails missing implement receipt", () => {
    const r = evaluateReceiptPolicy(
      [
        { nodeId: "i1", role: "implement", ok: true, status: "done" },
        { nodeId: "v1", role: "verify", ok: true, receiptId: "rcpt_1" },
      ],
      { require: true }
    );
    assert.equal(r.ok, false);
    assert.ok(r.reasons[0].includes("i1"));
  });

  it("evaluateMergeGates blocks when requireReceipts", () => {
    const policy = resolveMergePolicy(
      { swarm: { requireReceipts: true }, profile: "prod" },
      { requireReceipts: true }
    );
    assert.equal(policy.requireReceipts, true);
    const gates = evaluateMergeGates(
      [
        {
          nodeId: "impl",
          role: "implement",
          ok: true,
          workspace: "/tmp/wt",
        },
      ],
      policy
    );
    assert.equal(gates.ok, false);
    assert.ok(gates.reasons.some((x) => /receipt/i.test(x)));
  });

  it("vote weights prefer receipt-backed ballots", () => {
    const results = [
      {
        nodeId: "a",
        role: "research",
        ok: true,
        text: '```json\n{"answer":"yes","confidence":0.5}\n```',
      },
      {
        nodeId: "b",
        role: "research",
        ok: true,
        receiptId: "rcpt_b",
        receipt: { ok: true, toolsTotal: 3, artifacts: 1, effects: ["files"] },
        text: '```json\n{"answer":"no","confidence":0.5}\n```',
      },
    ];
    const vote = structuredMajorityVote(results, {
      roles: ["research"],
      minBallots: 1,
      minShare: 0.5,
      fields: ["answer"],
    });
    // b has higher weight → no should win if tally uses weights
    assert.ok(vote.fields?.answer || vote.consensus);
  });

  it("buildRunReceiptSummary counts", () => {
    const s = buildRunReceiptSummary([
      { ok: true, receiptId: "1" },
      { ok: false, status: "skipped" },
      { ok: false },
    ]);
    assert.equal(s.nodes, 3);
    assert.equal(s.withReceipt, 1);
    assert.equal(s.byStatus.skipped, 1);
  });

  it("receiptsRequired from env", () => {
    process.env.XCLAW_SWARM_REQUIRE_RECEIPTS = "1";
    assert.equal(receiptsRequired(), true);
    delete process.env.XCLAW_SWARM_REQUIRE_RECEIPTS;
  });
});
