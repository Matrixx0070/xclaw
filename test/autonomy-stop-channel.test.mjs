import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { autonomyStopChannelCheck } from "../src/eval/autonomy-stop-channel.mjs";
import { recordLastDrain } from "../src/gateway/last-drain.mjs";

describe("autonomy stop channel smoke", () => {
  it("passes for sse channel", () => {
    recordLastDrain({ sessionsKilled: 0, channel: "sse", authMethod: "hmac" });
    const r = autonomyStopChannelCheck();
    assert.equal(r.ok, true);
    assert.equal(r.channel, "sse");
  });
  it("fails unknown channel", () => {
    const r = autonomyStopChannelCheck({ lastDrain: { channel: "mqtt" } });
    assert.equal(r.ok, false);
  });
});
