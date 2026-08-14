import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { teeSwarmEvents, emitSwarmWs } from "../src/agents/swarm-events.mjs";
import { SWARM_PHASES, WS_CHANNELS } from "../src/gateway/event-types.mjs";

describe("swarm WS producer (B5)", () => {
  after(() => {
    delete globalThis.__xclawWsBroadcast;
  });

  it("teeSwarmEvents broadcasts on the swarm channel AND forwards to the caller", () => {
    const broadcast = [];
    const forwarded = [];
    globalThis.__xclawWsBroadcast = (ch, data) => broadcast.push({ ch, data });
    const onEvent = teeSwarmEvents((e) => forwarded.push(e), { swarmId: "swm_1" });

    onEvent({ type: "swarm", phase: "child_start", nodeId: "a" });
    onEvent({ type: "tool", phase: "end", name: "xclaw_bash" });

    assert.equal(broadcast.length, 2);
    assert.ok(broadcast.every((b) => b.ch === "swarm"));
    assert.equal(broadcast[0].data.swarmId, "swm_1", "swarmId injected when missing");
    assert.equal(forwarded.length, 2, "caller still receives everything");
  });

  it("survives a missing broadcast hook and a throwing caller", () => {
    delete globalThis.__xclawWsBroadcast;
    const onEvent = teeSwarmEvents(() => {
      throw new Error("caller boom");
    });
    assert.doesNotThrow(() => onEvent({ type: "swarm", phase: "swarm_done" }));
    globalThis.__xclawWsBroadcast = () => {
      throw new Error("ws boom");
    };
    assert.doesNotThrow(() => emitSwarmWs({ x: 1 }));
  });

  it("frozen vocabularies cover the canvas's needs", () => {
    for (const p of ["child_start", "child_retry", "child_done", "swarm_done"]) {
      assert.ok(SWARM_PHASES.includes(p));
    }
    assert.ok(WS_CHANNELS.includes("swarm") && WS_CHANNELS.includes("mission"));
  });
});
