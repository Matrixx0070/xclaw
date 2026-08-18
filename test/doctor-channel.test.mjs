import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStopChannel,
  isKnownStopChannel,
  STOP_CHANNELS,
} from "../src/cli/doctor-channel.mjs";
import { buildStopSummary } from "../src/cli/doctor-stop-summary.mjs";

describe("doctor channel enum", () => {
  it("normalizes http|ws|sse", () => {
    assert.equal(normalizeStopChannel("HTTP"), "http");
    assert.equal(normalizeStopChannel("websocket"), "ws");
    assert.equal(normalizeStopChannel("event-source"), "sse");
    assert.equal(normalizeStopChannel(null), "http");
    assert.equal(normalizeStopChannel("mqtt"), "unknown");
    assert.equal(isKnownStopChannel("ws"), true);
    assert.equal(isKnownStopChannel("mqtt"), false);
    assert.deepEqual(STOP_CHANNELS, ["http", "ws", "sse"]);
  });

  it("summary.stop exposes channels enum", () => {
    const s = buildStopSummary([
      {
        id: "security.killSwitch.lastDrain",
        status: "ok",
        detail: { channel: "sse", authMethod: "hmac" },
      },
    ]);
    assert.equal(s.lastDrainChannel, "sse");
    assert.deepEqual(s.channels, ["http", "ws", "sse"]);
  });
});
