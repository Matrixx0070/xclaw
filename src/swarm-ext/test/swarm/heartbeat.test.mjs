/**
 * Heartbeat Tests
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { Heartbeat } from "../../src/swarm/heartbeat.mjs";

describe("Heartbeat", () => {
  it("should start and stop", () => {
    const hb = new Heartbeat("agent_1", () => true, () => {});
    hb.start();
    assert.strictEqual(hb.running, true);
    hb.stop();
    assert.strictEqual(hb.running, false);
  });

  it("should declare dead after max failures", async () => {
    let failed = false;
    const hb = new Heartbeat("agent_2", () => false, () => { failed = true; });
    hb.maxFailures = 2;
    hb.intervalMs = 10;
    hb.start();
    await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(failed, true);
    hb.stop();
  });

  it("should reset failures on success", async () => {
    let calls = 0;
    const hb = new Heartbeat("agent_3", () => { calls++; return calls > 1; }, () => {});
    hb.maxFailures = 3;
    hb.intervalMs = 10;
    hb.start();
    await new Promise(r => setTimeout(r, 50));
    assert.ok(hb.consecutiveFailures < 3);
    hb.stop();
  });
});
