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

  it("isComputerOnlyTool true for browser", async () => {
    const { isComputerOnlyTool } = await import("../src/tools/planes.mjs");
    assert.equal(isComputerOnlyTool("xclaw_browser_tab"), true);
    assert.equal(isComputerOnlyTool("web_search"), false);
  });

  // Regression: strict-zod computer engines (the CDP bundle) reject unknown
  // input keys — every live bash call failed with InputValidationError on the
  // injected systemRunPlan until the router learned to enforce + strip it.
  describe("systemRunPlan vs plan-incapable computer", () => {
    it("strips the key and still forwards a valid plan's command", async () => {
      const { buildSystemRunPlan } = await import(
        "../src/security/system-run-plan.mjs"
      );
      const built = buildSystemRunPlan({
        tool: "xclaw_bash",
        args: { command: "echo plan-ok" },
      });
      assert.equal(built.ok, true);
      let seen;
      const computer = {
        async callTool(_s, _n, args) {
          seen = args;
          return { ok: true, stdout: "ran" };
        },
      };
      const router = createToolRouter({
        computer,
        sessionId: "s",
        computerAcceptsRunPlan: false,
      });
      const r = await router.dispatch({
        name: "xclaw_bash",
        args: { command: "echo plan-ok" },
        plan: built.plan,
      });
      assert.equal(r.ok, true);
      assert.ok(seen, "computer was called");
      assert.equal("systemRunPlan" in seen, false, "key stripped");
      assert.equal(seen.command, "echo plan-ok");
    });

    it("denies a drifted plan gateway-side without calling the computer", async () => {
      const { buildSystemRunPlan } = await import(
        "../src/security/system-run-plan.mjs"
      );
      const built = buildSystemRunPlan({
        tool: "xclaw_bash",
        args: { command: "echo frozen" },
      });
      assert.equal(built.ok, true);
      let called = false;
      const computer = {
        async callTool() {
          called = true;
          return { ok: true };
        },
      };
      const router = createToolRouter({
        computer,
        sessionId: "s",
        computerAcceptsRunPlan: false,
      });
      const r = await router.dispatch({
        name: "xclaw_bash",
        // live command mutated after the plan was frozen
        args: { command: "echo mutated" },
        plan: built.plan,
      });
      assert.equal(r.ok, false);
      assert.equal(r.blocked, true);
      assert.match(String(r.error), /spawn enforce/);
      assert.equal(called, false, "computer never reached");
    });

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
        computerAcceptsRunPlan: true,
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
