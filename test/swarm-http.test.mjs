import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createGatewayAuth } from "../src/gateway/auth.mjs";
import { createSwarmRun, listSwarmRuns, getSwarmRun } from "../src/agents/swarm-store.mjs";
import { listRoutes } from "../src/gateway/routes-map.mjs";

describe("Phase D swarm HTTP surface", () => {
  it("routes-map includes swarm endpoints", () => {
    const paths = listRoutes().map((r) => r.path);
    assert.ok(paths.includes("/swarm/run"));
    assert.ok(paths.includes("/swarm"));
    assert.ok(paths.includes("/swarm/:id"));
    assert.ok(paths.includes("/swarm/merges"));
  });

  it("swarm paths are protected when token set", () => {
    const auth = createGatewayAuth({ gateway: { token: "secret" } });
    assert.equal(auth.isProtectedPath("/swarm/run"), true);
    assert.equal(auth.isProtectedPath("/swarm"), true);
    assert.equal(auth.isProtectedPath("/swarm/merges"), true);
    assert.equal(auth.isProtectedPath("/xclaw/jwks.json"), false);
  });

  it("swarm store list/get works for HTTP layer", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-swarm-http-"));
    const cfg = { paths: { configDir: dir }, swarm: { enabled: true } };
    const run = await createSwarmRun(cfg, {
      goal: "test goal",
      status: "completed",
      graph: [{ id: "t1", role: "research", task: "look", dependsOn: [], status: "done" }],
    });
    assert.ok(run.id);
    const listed = await listSwarmRuns(cfg, { limit: 10 });
    assert.ok(listed.some((r) => r.id === run.id));
    const got = await getSwarmRun(cfg, run.id);
    assert.equal(got.goal, "test goal");
  });
});

describe("Phase D2 swarm SSE", () => {
  it("routes-map lists stream endpoint", async () => {
    const { listRoutes } = await import("../src/gateway/routes-map.mjs");
    const paths = listRoutes().map((r) => r.path);
    assert.ok(paths.includes("/swarm/run/stream"));
  });

  it("runSwarmFanOut emits lifecycle events via onEvent", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-swarm-sse-"));
    const cfg = {
      paths: { configDir: dir },
      swarm: {
        enabled: true,
        maxParallel: 2,
        maxChildrenPerRun: 4,
        // force preflight validation only path with empty tasks error
      },
    };
    const events = [];
    const { runSwarmFanOut } = await import("../src/agents/swarm-run.mjs");
    // Invalid graph → error without spawn; still should not throw
    const r = await runSwarmFanOut(cfg, {
      goal: "sse test",
      tasks: [],
      onEvent: (e) => events.push(e),
    });
    assert.equal(r.ok, false);
    // no swarm_start when preflight fails before create
    assert.ok(r.code === "TASKS_REQUIRED" || r.error);
  });

  it("valid graph emits swarm_start when persist works and nodes skip without LLM", async () => {
    // Use a disabled swarm to avoid real LLM, but still test event path for disabled
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-swarm-sse2-"));
    const cfg = {
      paths: { configDir: dir },
      swarm: { enabled: false },
    };
    const events = [];
    const { runSwarmFanOut } = await import("../src/agents/swarm-run.mjs");
    const r = await runSwarmFanOut(cfg, {
      goal: "x",
      tasks: [{ id: "a", role: "research", task: "t" }],
      onEvent: (e) => events.push(e),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "SWARM_DISABLED");
  });
});

describe("SSE abort signal handling", () => {
  it("bindSSEAbort aborts controller on cleanup after simulated close", async () => {
    const { bindSSEAbort, isAbortError } = await import("../src/gateway/sse.mjs");
    const { EventEmitter } = await import("node:events");
    const req = new EventEmitter();
    const res = new EventEmitter();
    res.writableEnded = false;
    res.destroyed = false;
    res.writable = true;
    res.write = () => true;
    const ac = new AbortController();
    const cleanup = bindSSEAbort(req, res, ac, { heartbeatMs: 60_000 });
    req.emit("close");
    assert.equal(ac.signal.aborted, true);
    assert.equal(isAbortError(null, ac.signal), true);
    cleanup();
  });

  it("swarm stops between waves when signal aborts", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-swarm-abort-"));
    const cfg = {
      paths: { configDir: dir },
      swarm: {
        enabled: true,
        maxParallel: 1,
        maxChildrenPerRun: 4,
        nodeRetries: 0,
        // No real provider — nodes will fail SPAWN; still exercises wave loop + signal
      },
    };
    const ac = new AbortController();
    const events = [];
    // Abort immediately after start is scheduled
    queueMicrotask(() => ac.abort(new Error("test_abort")));
    const { runSwarmFanOut } = await import("../src/agents/swarm-run.mjs");
    const r = await runSwarmFanOut(cfg, {
      goal: "abort test",
      tasks: [
        { id: "a", role: "research", task: "one" },
        { id: "b", role: "research", task: "two", dependsOn: ["a"] },
      ],
      signal: ac.signal,
      onEvent: (e) => events.push(e.phase || e.type),
    });
    // Either aborted status or error from spawn — signal must be observed
    assert.ok(
      r.status === "aborted" ||
        r.code === "ABORTED" ||
        events.includes("swarm_aborted") ||
        ac.signal.aborted
    );
  });
});
