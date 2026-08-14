
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReceiptPolicy,
  failedReceiptsRequired,
  hasReceipt,
  DEFAULT_CRITICAL_ROLES,
  resolveCriticalRoles,
} from "../src/agents/swarm-receipt.mjs";

describe("receipt policy requireFailedReceipts", () => {
  it("success without receipt fails when require", () => {
    const r = evaluateReceiptPolicy(
      [{ nodeId: "a", role: "implement", ok: true, status: "done" }],
      { requireReceipts: true }
    );
    assert.equal(r.ok, false);
    assert.ok(r.summary.criticalMissing.includes("a"));
  });

  it("fail without receipt passes when requireFailedReceipts off", () => {
    const r = evaluateReceiptPolicy(
      [{ nodeId: "b", role: "implement", ok: false, status: "error" }],
      { requireReceipts: true }
    );
    assert.equal(r.ok, true);
    assert.equal(r.summary.criticalFailedMissing.length, 0);
  });

  it("fail without receipt fails when requireFailedReceipts on", () => {
    const r = evaluateReceiptPolicy(
      [{ nodeId: "b", role: "implement", ok: false, status: "error" }],
      { requireFailedReceipts: true }
    );
    assert.equal(r.ok, false);
    assert.ok(r.summary.criticalFailedMissing.includes("b"));
    assert.match(r.reasons[0], /failed\/skipped receipt required/);
  });

  it("skipped without receipt fails when requireFailedReceipts on", () => {
    const r = evaluateReceiptPolicy(
      [
        {
          nodeId: "c",
          role: "verify",
          ok: false,
          status: "skipped",
          code: "UPSTREAM_FAILED",
        },
      ],
      { requireFailedReceipts: true }
    );
    assert.equal(r.ok, false);
    assert.ok(r.summary.criticalFailedMissing.includes("c"));
  });

  it("skipped with receipt passes requireFailedReceipts", () => {
    const r = evaluateReceiptPolicy(
      [
        {
          nodeId: "c",
          role: "verify",
          ok: false,
          status: "skipped",
          receiptId: "rcpt_1",
        },
      ],
      { requireFailedReceipts: true, requireReceipts: true }
    );
    assert.equal(r.ok, true);
  });

  it("non-critical fail without receipt still ok under requireFailedReceipts", () => {
    const r = evaluateReceiptPolicy(
      [{ nodeId: "d", role: "explore", ok: false, status: "error" }],
      { requireFailedReceipts: true }
    );
    assert.equal(r.ok, true);
  });

  it("forbidPending flags pending rows", () => {
    const r = evaluateReceiptPolicy(
      [{ nodeId: "e", role: "implement", ok: false, status: "pending" }],
      { forbidPending: true }
    );
    assert.equal(r.ok, false);
    assert.ok(r.summary.pendingIds.includes("e"));
  });

  it("failedReceiptsRequired reads cfg and env", () => {
    assert.equal(failedReceiptsRequired({}, {}), false);
    assert.equal(
      failedReceiptsRequired({ swarm: { requireFailedReceipts: true } }, {}),
      true
    );
    assert.equal(
      failedReceiptsRequired({}, { requireFailedReceipts: true }),
      true
    );
  });

  it("hasReceipt accepts receiptId", () => {
    assert.equal(hasReceipt({ receiptId: "x" }), true);
    assert.equal(hasReceipt({}), false);
  });
});

describe("critical roles list", () => {
  it("DEFAULT_CRITICAL_ROLES includes research and actor", () => {
    assert.ok(DEFAULT_CRITICAL_ROLES.includes("implement"));
    assert.ok(DEFAULT_CRITICAL_ROLES.includes("verify"));
    assert.ok(DEFAULT_CRITICAL_ROLES.includes("critic"));
    assert.ok(DEFAULT_CRITICAL_ROLES.includes("research"));
    assert.ok(DEFAULT_CRITICAL_ROLES.includes("actor"));
    assert.ok(DEFAULT_CRITICAL_ROLES.includes("planner"));
  });

  it("resolveCriticalRoles prefers opts then cfg then default", () => {
    assert.deepEqual(resolveCriticalRoles({ criticalRoles: ["merge"] }), ["merge"]);
    assert.deepEqual(
      resolveCriticalRoles({}, { swarm: { criticalRoles: ["implement", "Verify"] } }),
      ["implement", "verify"]
    );
    assert.equal(resolveCriticalRoles().length, DEFAULT_CRITICAL_ROLES.length);
  });

  it("research success without receipt fails under default critical set", () => {
    const r = evaluateReceiptPolicy(
      [{ nodeId: "r1", role: "research", ok: true, status: "done" }],
      { requireReceipts: true }
    );
    assert.equal(r.ok, false);
    assert.ok(r.summary.criticalMissing.includes("r1"));
  });

  it("observer remains non-critical by default", () => {
    const r = evaluateReceiptPolicy(
      [{ nodeId: "o1", role: "observer", ok: true, status: "done" }],
      { requireReceipts: true }
    );
    assert.equal(r.ok, true);
  });
});
