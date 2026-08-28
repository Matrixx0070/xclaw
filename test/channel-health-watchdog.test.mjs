import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  startChannelHealthWatchdog,
  stopChannelHealthWatchdog,
  channelHealthStatus,
} from "../src/channels/health-watchdog.mjs";

describe("R1 channel health watchdog", () => {
  it("starts and reports status", () => {
    const manager = {
      status: () => [
        {
          name: "telegram",
          enabled: true,
          running: true,
          loopAlive: true,
        },
      ],
      restartChannel: async () => ({ ok: true }),
    };
    const r = startChannelHealthWatchdog(
      { channels: { healthWatchdog: { enabled: true } } },
      manager,
      { intervalMs: 60_000 }
    );
    assert.equal(r.ok, true);
    const st = channelHealthStatus();
    assert.equal(st.running, true);
    stopChannelHealthWatchdog();
    assert.equal(channelHealthStatus().running, false);
  });

  it("distinguishes a config opt-out from a stopped watchdog", () => {
    // Both report `running: false`. Without this flag the doctor cannot tell an
    // operator's deliberate opt-out from a watchdog that ought to be running,
    // and graded both as "idle (start gateway to enable)".
    const manager = { status: () => [], restartChannel: async () => ({ ok: true }) };

    const off = startChannelHealthWatchdog({ channels: { healthWatchdog: { enabled: false } } }, manager);
    assert.equal(off.ok, false);
    assert.equal(channelHealthStatus().disabled, true, "a declined start must be visible to readers");
    assert.equal(channelHealthStatus().running, false);

    startChannelHealthWatchdog({ channels: { healthWatchdog: { enabled: true } } }, manager, {
      intervalMs: 60_000,
    });
    assert.equal(channelHealthStatus().disabled, false, "a successful start must clear it");

    // An explicit stop is not a config opt-out.
    stopChannelHealthWatchdog();
    assert.equal(channelHealthStatus().running, false);
    assert.equal(channelHealthStatus().disabled, false);
  });

  it("createChannelManager exposes restartChannel", async () => {
    const { createChannelManager } = await import("../src/channels/manager.mjs");
    const m = createChannelManager({ channels: {} });
    assert.equal(typeof m.restartChannel, "function");
    assert.equal(typeof m.get, "function");
    assert.ok(Array.isArray(m.status()));
  });
});
