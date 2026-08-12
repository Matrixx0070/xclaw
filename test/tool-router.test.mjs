import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createToolRouter } from "../src/tools/router.mjs";

describe("T1 tool router", () => {
  it("routes to computer adapter", async () => {
    const calls = [];
    const computer = {
      async callTool(sessionId, name, args) {
        calls.push({ sessionId, name, args });
        return { ok: true, stdout: "hi" };
      },
    };
    const router = createToolRouter({ computer, sessionId: "s1", localTools: [] });
    const r = await router.dispatch({
      callId: "c1",
      name: "xclaw_bash",
      args: { command: "echo hi" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.plane, "computer");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "xclaw_bash");
  });

  it("routes agent handler", async () => {
    const router = createToolRouter({
      agentHandlers: {
        xclaw_recall: async (args) => ({ ok: true, hits: [], q: args.q }),
      },
    });
    const r = await router.dispatch({
      name: "xclaw_recall",
      args: { q: "test" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.plane, "agent");
    assert.equal(r.result.q, "test");
  });

  it("attaches systemRunPlan from req.plan", async () => {
    let seen;
    const computer = {
      async callTool(_s, _n, args) {
        seen = args;
        return { ok: true };
      },
    };
    const router = createToolRouter({ computer, sessionId: "s" });
    await router.dispatch({
      name: "xclaw_bash",
      args: { command: "true" },
      plan: { fingerprint: "abc", command: "true" },
    });
    assert.equal(seen.systemRunPlan.fingerprint, "abc");
  });

  it("returns aborted when signal aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const router = createToolRouter({
      computer: { callTool: async () => ({ ok: true }) },
    });
    const r = await router.dispatch({
      name: "xclaw_bash",
      args: { command: "true" },
      signal: ac.signal,
    });
    assert.equal(r.ok, false);
    assert.equal(r.blocked, true);
    assert.equal(r.error, "aborted");
  });

  it("partitionByConcurrency exposed", () => {
    const router = createToolRouter({});
    const { parallel, serial } = router.partitionByConcurrency([
      { name: "xclaw_file_read" },
      { name: "xclaw_bash" },
    ]);
    assert.equal(parallel.length, 1);
    assert.equal(serial.length, 1);
  });
});
