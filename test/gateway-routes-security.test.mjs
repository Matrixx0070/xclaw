import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tryHandleSecurityRoute } from "../src/gateway/routes/security.mjs";
import { createApprovalGate } from "../src/security/approvals.mjs";

function mockRes() {
  return {
    status: null,
    body: null,
    writeHead() {},
    end() {},
  };
}

describe("gateway routes/security", () => {
  it("lists pending", async () => {
    const gate = createApprovalGate({
      // generous timeouts: under full-suite load a short SLA can deny the
      // pending before this test lists it (observed load-dependent flake);
      // cleanup below decides explicitly, so nothing waits these out.
      security: { autoApprove: false, approvalPolicy: "risky", approvalTimeoutMs: 60_000 },
    });
    // create a pending without waiting; poll until it registers (deadline,
    // not a fixed sleep — timer starvation under load broke the fixed wait)
    const pendingPromise = gate.authorize("xclaw_bash", { command: "echo x" }, { timeoutMs: 60_000 });
    const deadline = Date.now() + 10_000;
    while (gate.listPending().length < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const res = mockRes();
    let payload = null;
    const json = (_res, status, body) => {
      payload = { status, body };
    };
    const handled = await tryHandleSecurityRoute({
      p: "/security/pending",
      method: "GET",
      req: {},
      res,
      cfg: {},
      approvalGate: gate,
      json,
      readBody: async () => ({}),
    });
    assert.equal(handled, true);
    assert.equal(payload.status, 200);
    assert.ok(Array.isArray(payload.body.pending));
    assert.ok(payload.body.count >= 1);

    // cleanup
    const id = payload.body.pending[0]?.id;
    if (id) gate.decide(id, false, "test cleanup");
    await pendingPromise.catch(() => {});
  });

  it("decide requires id", async () => {
    const gate = createApprovalGate({ security: { autoApprove: true } });
    let payload = null;
    const handled = await tryHandleSecurityRoute({
      p: "/security/decide",
      method: "POST",
      req: {},
      res: mockRes(),
      cfg: {},
      approvalGate: gate,
      json: (_r, status, body) => {
        payload = { status, body };
      },
      readBody: async () => ({}),
    });
    assert.equal(handled, true);
    assert.equal(payload.status, 400);
  });

  it("policy includes controlPlane and computerEngine", async () => {
    const gate = createApprovalGate({ security: { autoApprove: true } });
    let payload = null;
    const handled = await tryHandleSecurityRoute({
      p: "/security/policy",
      method: "GET",
      req: {},
      res: mockRes(),
      cfg: { security: { approvalPolicy: "risky" }, channels: {} },
      approvalGate: gate,
      json: (_r, status, body) => {
        payload = { status, body };
      },
      readBody: async () => ({}),
    });
    assert.equal(handled, true);
    assert.equal(payload.status, 200);
    assert.equal(payload.body.controlPlane, "gateway");
    assert.ok(payload.body.approvalGate);
    assert.ok(payload.body.computerEngine);
    assert.ok(["bundle","native","generated"].includes(payload.body.computerEngine.engine));
  });

  it("returns false for unrelated paths", async () => {
    const handled = await tryHandleSecurityRoute({
      p: "/health",
      method: "GET",
      req: {},
      res: mockRes(),
      cfg: {},
      approvalGate: createApprovalGate({}),
      json: () => {},
      readBody: async () => ({}),
    });
    assert.equal(handled, false);
  });
});
