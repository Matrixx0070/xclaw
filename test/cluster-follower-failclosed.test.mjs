import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { proxyReserve } from "../src/cluster/coordinator.mjs";

describe("follower fail-closed", () => {
  it("COORDINATOR_UNREACHABLE when url dead", async () => {
    const cfg = {
      cluster: { coordinatorUrl: "http://127.0.0.1:1", role: "follower" },
      tokens: { dailyHardUsd: 10 },
    };
    const r = await proxyReserve(cfg, { swarmId: "s", childId: "c", usd: 0.01 });
    assert.equal(r.ok, false);
    assert.equal(r.code, "COORDINATOR_UNREACHABLE");
  });
});
