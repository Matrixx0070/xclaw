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

describe("T3 computer-only plane", () => {
  it("blocks bash when computer unavailable", async () => {
    const { createToolRouter } = await import("../src/tools/router.mjs");
    const router = createToolRouter({ computer: null, localTools: [] });
    const r = await router.dispatch({
      name: "xclaw_bash",
      args: { command: "echo x" },
    });
    assert.equal(r.ok, false);
    assert.equal(r.blocked, true);
    assert.equal(r.plane, "computer");
    assert.match(String(r.error), /computer plane unavailable/i);
  });

  it("does not execute computer tools via local adapter", async () => {
    const { createToolRouter } = await import("../src/tools/router.mjs");
    let localRan = false;
    const localTools = [
      {
        name: "xclaw_bash",
        execute: async () => {
          localRan = true;
          return { ok: true, stdout: "from-local" };
        },
      },
    ];
    // registry uses different shape — router uses executeLocalTool from registry
    // Even with a misleading local name set, computer-only must require computer
    const router = createToolRouter({
      computer: null,
      localTools,
    });
    const r = await router.dispatch({
      name: "xclaw_bash",
      args: { command: "true" },
    });
    assert.equal(r.ok, false);
    assert.equal(localRan, false);
  });

  it("recreates a computer session after SESSION_GONE", async () => {
    const calls = [];
    const computer = {
      async callTool(sessionId, name) {
        calls.push(sessionId);
        if (sessionId === "dead") {
          const e = new Error("session not found");
          e.status = 404;
          e.code = "SESSION_GONE";
          throw e;
        }
        return { ok: true, stdout: "ok" };
      },
      async createSession() {
        return "fresh";
      },
    };
    let sid = "dead";
    const router = createToolRouter({
      computer,
      sessionId: () => sid,
      setSessionId: (id) => {
        sid = id;
      },
      localTools: [],
    });
    const r = await router.dispatch({
      name: "xclaw_bash",
      args: { command: "echo" },
    });
    assert.equal(r.ok, true);
    assert.equal(sid, "fresh");
    assert.deepEqual(calls, ["dead", "fresh"]);
  });

  it("callToolRecovering recreates the session the same way", async () => {
    const { callToolRecovering } = await import("../src/agent/computer-client.mjs");
    const calls = [];
    const computer = {
      async callTool(sessionId) {
        calls.push(sessionId);
        if (sessionId === "dead") {
          const e = new Error("session not found");
          e.status = 404;
          throw e;
        }
        return { ok: true };
      },
      async createSession() {
        return "fresh";
      },
    };
    let sid = "dead";
    const r = await callToolRecovering(computer, () => sid, "xclaw_bash", {}, {
      setSessionId: (id) => {
        sid = id;
      },
    });
    assert.equal(r.ok, true);
    assert.equal(sid, "fresh");
    assert.deepEqual(calls, ["dead", "fresh"]);
  });

  it("isComputerOnlyTool true for browser", async () => {
    const { isComputerOnlyTool } = await import("../src/tools/planes.mjs");
    assert.equal(isComputerOnlyTool("xclaw_browser_tab"), true);
    assert.equal(isComputerOnlyTool("web_search"), false);
  });

  // Single native engine (ADR 0005): the injected systemRunPlan is always
  // forwarded — the native bash tool enforces the frozen plan at spawn time.
  describe("systemRunPlan forwarding (single native engine)", () => {
    it("passes the key through when the engine declares support", async () => {
      let seen;
      const computer = {
        async callTool(_s, _n, args) {
          seen = args;
          return { ok: true };
        },
      };
      const router = createToolRouter({
        computer,
        sessionId: "s",
      });
      await router.dispatch({
        name: "xclaw_bash",
        args: { command: "true" },
        plan: { fingerprint: "abc", command: "true" },
      });
      assert.equal(seen.systemRunPlan.fingerprint, "abc");
    });
  });
});
