import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  handoffLimits,
  truncateWithMarker,
  resolveSwarmCaps,
  buildUpstreamContext,
  runSwarmFanOut,
} from "../src/agents/swarm-run.mjs";
import { spawnSubagent } from "../src/agents/spawn.mjs";

describe("swarm handoff limits (2.5)", () => {
  it("defaults raised to 6000/4000, config overrides honored, floor enforced", () => {
    assert.deepEqual(handoffLimits({}), { upstream: 6000, result: 4000 });
    assert.deepEqual(handoffLimits({ upstreamMaxChars: 12000, resultMaxChars: 9000 }), {
      upstream: 12000,
      result: 9000,
    });
    // floor at 200; garbage falls back to defaults
    assert.equal(handoffLimits({ upstreamMaxChars: 5 }).upstream, 200);
    assert.equal(handoffLimits({ upstreamMaxChars: "nope" }).upstream, 6000);
  });

  it("truncation is marked exactly when it occurs", () => {
    const short = truncateWithMarker("hello", 100, "upstreamMaxChars");
    assert.equal(short, "hello"); // no marker when under limit
    const long = truncateWithMarker("x".repeat(300), 200, "upstreamMaxChars");
    assert.match(long, /…\[truncated 100 chars — raise swarm\.upstreamMaxChars\]/);
    assert.ok(long.startsWith("x".repeat(200)));
  });

  it("buildUpstreamContext threads config and marks cut dependency output", () => {
    const results = new Map([
      ["dep1", { role: "research", status: "done", ok: true, text: "y".repeat(500) }],
    ]);
    const node = { id: "n2", dependsOn: ["dep1"] };
    const cut = buildUpstreamContext(node, results, { upstreamMaxChars: 200 });
    assert.match(cut, /truncated .* raise swarm\.upstreamMaxChars/);
    const whole = buildUpstreamContext(node, results, { upstreamMaxChars: 2000 });
    assert.ok(!whole.includes("truncated"), "no marker when content fits");
  });
});

describe("swarm caps config (2.6)", () => {
  it("defaults preserved, overrides honored, absolute ceilings clamp", () => {
    assert.deepEqual(resolveSwarmCaps({}), { maxParallel: 3, maxChildren: 8 });
    assert.deepEqual(resolveSwarmCaps({ maxParallel: 10, maxNodes: 20 }), {
      maxParallel: 10,
      maxChildren: 20,
    });
    // legacy alias still works
    assert.equal(resolveSwarmCaps({ maxChildrenPerRun: 12 }).maxChildren, 12);
    // maxNodes wins over legacy alias
    assert.equal(resolveSwarmCaps({ maxNodes: 15, maxChildrenPerRun: 4 }).maxChildren, 15);
    // ceilings
    assert.deepEqual(resolveSwarmCaps({ maxParallel: 999, maxNodes: 999 }), {
      maxParallel: 16,
      maxChildren: 50,
    });
    // floors
    assert.deepEqual(resolveSwarmCaps({ maxParallel: 0, maxNodes: -3 }), {
      maxParallel: 3, // 0 is falsy → default
      maxChildren: 1,
    });
  });
});

describe("spawn depth guard", () => {
  it("spawnSubagent refuses beyond maxSpawnDepth with a structured result", async () => {
    const out = await spawnSubagent({
      task: "do nothing",
      cfg: { swarm: { _spawnDepth: 2, maxSpawnDepth: 2 } },
    });
    assert.equal(out.ok, false);
    assert.equal(out.code, "SPAWN_DEPTH_EXCEEDED");
    assert.equal(out.depth, 2);
    assert.match(out.error, /maxSpawnDepth/);
  });

  it("spawnSubagent honors a raised limit (guard passes at depth < max)", async () => {
    // depth 2 with maxSpawnDepth 5 must NOT trip the guard. We can't run a real
    // agent here, so prove guard passage by the failure mode changing: the call
    // proceeds past the guard and fails later in the loop (no provider), never
    // with SPAWN_DEPTH_EXCEEDED.
    const out = await spawnSubagent({
      task: "noop",
      timeoutMs: 5_000,
      cfg: {
        swarm: { _spawnDepth: 2, maxSpawnDepth: 5 },
        agent: { provider: "ollama", model: "does-not-exist", baseUrl: "http://127.0.0.1:1" },
        computer: { autoStart: false, nativeServer: false },
      },
    });
    assert.notEqual(out.code, "SPAWN_DEPTH_EXCEEDED");
  });

  it("runSwarmFanOut refuses at depth >= maxSpawnDepth", async () => {
    const out = await runSwarmFanOut(
      { swarm: { _spawnDepth: 2, maxSpawnDepth: 2 } },
      { tasks: ["a"] }
    );
    assert.equal(out.ok, false);
    assert.equal(out.code, "SPAWN_DEPTH_EXCEEDED");
    assert.match(out.details?.hint || "", /maxSpawnDepth/);
  });

  it("runSwarmFanOut passes the guard at depth 0 (fails later on empty tasks)", async () => {
    const out = await runSwarmFanOut({ swarm: {} }, { tasks: [] });
    assert.equal(out.ok, false);
    assert.equal(out.code, "TASKS_REQUIRED"); // guard passed, later check fired
  });
});
