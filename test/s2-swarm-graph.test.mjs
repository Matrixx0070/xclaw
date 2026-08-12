import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeTaskGraph } from "../src/agents/swarm-run.mjs";
import { topologicalWaves } from "../src/agents/graph-viz.mjs";

describe("S2 task graph normalize", () => {
  it("assigns ids to flat string tasks (S1 compat)", () => {
    const { nodes, error } = normalizeTaskGraph(["a", "b"]);
    assert.equal(error, undefined);
    assert.equal(nodes.length, 2);
    assert.equal(nodes[0].id, "t0");
    assert.equal(nodes[1].id, "t1");
    assert.deepEqual(nodes[0].dependsOn, []);
  });

  it("accepts linear dependsOn chain", () => {
    const { nodes, error } = normalizeTaskGraph([
      { id: "impl", task: "add health", role: "implement" },
      {
        id: "verify",
        task: "curl health",
        role: "verify",
        dependsOn: ["impl"],
      },
      {
        id: "critic",
        task: "review",
        role: "critic",
        dependsOn: ["verify"],
      },
    ]);
    assert.equal(error, undefined);
    const waves = topologicalWaves(nodes);
    assert.equal(waves.length, 3);
    assert.equal(waves[0][0].id, "impl");
    assert.equal(waves[2][0].id, "critic");
  });

  it("accepts diamond graph", () => {
    const { nodes, error } = normalizeTaskGraph([
      { id: "r1", task: "A", role: "research" },
      { id: "r2", task: "B", role: "research" },
      {
        id: "join",
        task: "merge",
        role: "research",
        dependsOn: ["r1", "r2"],
      },
    ]);
    assert.equal(error, undefined);
    const waves = topologicalWaves(nodes);
    assert.equal(waves.length, 2);
    assert.equal(waves[0].length, 2);
    assert.equal(waves[1][0].id, "join");
  });

  it("rejects cycle", () => {
    const { error, code } = normalizeTaskGraph([
      { id: "a", task: "x", dependsOn: ["b"] },
      { id: "b", task: "y", dependsOn: ["a"] },
    ]);
    assert.match(error, /cycle/i);
    assert.equal(code, "CYCLE");
  });

  it("rejects unknown dependsOn", () => {
    const { error, code, details } = normalizeTaskGraph([
      { id: "a", task: "x", dependsOn: ["missing"] },
    ]);
    assert.match(error, /unknown dependsOn/);
    assert.equal(code, "UNKNOWN_DEP");
    assert.equal(details.dependsOn, "missing");
  });

  it("rejects self-dependency", () => {
    const { error, code } = normalizeTaskGraph([
      { id: "a", task: "x", dependsOn: ["a"] },
    ]);
    assert.match(error, /self-dependency/);
    assert.equal(code, "SELF_DEP");
  });

  it("rejects duplicate ids", () => {
    const { error, code, details } = normalizeTaskGraph([
      { id: "a", task: "x" },
      { id: "a", task: "y" },
    ]);
    assert.match(error, /duplicate/);
    assert.equal(code, "DUPLICATE_ID");
    assert.ok(details.duplicates?.includes("a"));
  });

  it("rejects empty tasks", () => {
    const { error, code } = normalizeTaskGraph([]);
    assert.match(error, /tasks required/);
    assert.equal(code, "TASKS_REQUIRED");
  });
});

describe("S2 swarmError helper", () => {
  it("marks persist/spawn as retryable", async () => {
    const { swarmError } = await import("../src/agents/swarm-run.mjs");
    const a = swarmError("PERSIST_FAILED", "disk full");
    assert.equal(a.retryable, true);
    assert.equal(a.code, "PERSIST_FAILED");
    const b = swarmError("CYCLE", "cycle detected");
    assert.equal(b.retryable, false);
  });
});

describe("S2 node retry helpers", () => {
  it("decorrelated stays within bounds", async () => {
    const { retryBackoffMs } = await import("../src/agents/swarm-run.mjs");
    for (let i = 1; i <= 5; i++) {
      const ms = retryBackoffMs(i, {
        strategy: "decorrelated",
        baseMs: 100,
        capMs: 1000,
      });
      assert.ok(ms >= 100 && ms <= 1000, `attempt ${i}: ${ms}`);
    }
  });

  it("exponential grows as base * 2^(n-1) until cap", async () => {
    const { retryBackoffMs } = await import("../src/agents/swarm-run.mjs");
    assert.equal(
      retryBackoffMs(1, {
        strategy: "exponential",
        baseMs: 100,
        capMs: 10_000,
      }),
      100
    );
    assert.equal(
      retryBackoffMs(2, {
        strategy: "exponential",
        baseMs: 100,
        capMs: 10_000,
      }),
      200
    );
    assert.equal(
      retryBackoffMs(3, {
        strategy: "exponential",
        baseMs: 100,
        capMs: 10_000,
      }),
      400
    );
    assert.equal(
      retryBackoffMs(10, {
        strategy: "exponential",
        baseMs: 100,
        capMs: 1000,
      }),
      1000
    );
  });

  it("full jitter is in [0, exp]", async () => {
    const { retryBackoffMs } = await import("../src/agents/swarm-run.mjs");
    for (let i = 0; i < 20; i++) {
      const ms = retryBackoffMs(3, {
        strategy: "full",
        baseMs: 100,
        capMs: 10_000,
      });
      assert.ok(ms >= 0 && ms <= 400, `full jitter ${ms}`);
    }
  });

  it("equal jitter is in [exp/2, exp]", async () => {
    const { retryBackoffMs } = await import("../src/agents/swarm-run.mjs");
    for (let i = 0; i < 20; i++) {
      const ms = retryBackoffMs(3, {
        strategy: "equal",
        baseMs: 100,
        capMs: 10_000,
      });
      assert.ok(ms >= 200 && ms <= 400, `equal jitter ${ms}`);
    }
  });

  it("none returns 0", async () => {
    const { retryBackoffMs } = await import("../src/agents/swarm-run.mjs");
    assert.equal(retryBackoffMs(3, { strategy: "none", baseMs: 100 }), 0);
  });

  it("respects Retry-After when higher than computed", async () => {
    const { retryBackoffMs } = await import("../src/agents/swarm-run.mjs");
    const ms = retryBackoffMs(1, {
      strategy: "exponential",
      baseMs: 100,
      capMs: 60_000,
      retryAfterMs: 5_000,
      respectRetryAfter: true,
      retryAfterJitterRatio: 0,
    });
    assert.ok(ms >= 5_000, `expected >= 5000 got ${ms}`);
  });

  it("isRetryableNodeResult for SPAWN_FAILED and TIMEOUT", async () => {
    const { isRetryableNodeResult } = await import(
      "../src/agents/swarm-run.mjs"
    );
    assert.equal(
      isRetryableNodeResult({ ok: false, code: "SPAWN_FAILED" }),
      true
    );
    assert.equal(isRetryableNodeResult({ ok: false, code: "TIMEOUT" }), true);
    assert.equal(isRetryableNodeResult({ ok: false, code: "ABORTED" }), false);
    assert.equal(isRetryableNodeResult({ ok: true }), false);
  });
});
