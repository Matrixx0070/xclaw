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

  it("createChannelManager exposes restartChannel", async () => {
    const { createChannelManager } = await import("../src/channels/manager.mjs");
    const m = createChannelManager({ channels: {} });
    assert.equal(typeof m.restartChannel, "function");
    assert.equal(typeof m.get, "function");
    assert.ok(Array.isArray(m.status()));
  });
});
