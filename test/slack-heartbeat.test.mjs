import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSlackChannel } from "../src/channels/slack/index.mjs";

describe("Slack Socket Mode heartbeat config", () => {
  it("exposes heartbeatMs on status when socket configured", () => {
    const ch = createSlackChannel({
      channels: {
        slack: {
          enabled: true,
          botToken: "xoxb-test",
          appToken: "xapp-test",
          socketMode: true,
          heartbeatMs: 45000,
        },
      },
    });
    assert.equal(ch.enabled, true);
    const st = ch.status();
    assert.equal(st.mode, "socket");
    assert.equal(st.heartbeatMs, 45000);
  });

  it("default heartbeat 90s", () => {
    const ch = createSlackChannel({
      channels: {
        slack: {
          enabled: true,
          botToken: "xoxb-test",
          appToken: "xapp-test",
        },
      },
    });
    assert.equal(ch.status().heartbeatMs, 90_000);
  });

  it("heartbeat can be disabled with 0", () => {
    const ch = createSlackChannel({
      channels: {
        slack: {
          enabled: true,
          botToken: "xoxb-test",
          appToken: "xapp-test",
          heartbeatMs: 0,
        },
      },
    });
    assert.equal(ch.status().heartbeatMs, 0);
  });
});
