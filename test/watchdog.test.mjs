
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { startComputerWatchdog, stopComputerWatchdog, watchdogStatus } from "../src/computer/watchdog.mjs";

describe("computer watchdog", () => {
  it("starts and stops with status fields", () => {
    const r = startComputerWatchdog(
      { computer: { host: "127.0.0.1", port: 4243, watchdog: { enabled: true, intervalMs: 60_000 } } },
      { intervalMs: 60_000 }
    );
    assert.equal(r.ok, true);
    const s = watchdogStatus();
    assert.equal(s.active, true);
    assert.equal(typeof s.restartCount, "number");
    stopComputerWatchdog();
    assert.equal(watchdogStatus().active, false);
  });
  it("respects disabled", () => {
    const r = startComputerWatchdog(
      { computer: { watchdog: { enabled: false } } },
      { enabled: false }
    );
    assert.equal(r.ok, false);
  });
});
