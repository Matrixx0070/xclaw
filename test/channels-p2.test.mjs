import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createChannelManager } from "../src/channels/manager.mjs";
import { createSlackChannel } from "../src/channels/slack/index.mjs";
import { createEmailChannel } from "../src/channels/email/index.mjs";
import fs from "node:fs";

describe("P2 channels", () => {
  it("manager includes slack and email", () => {
    const m = createChannelManager({ channels: {} });
    const names = m.status().map((s) => s.name).sort();
    assert.deepEqual(names, ["discord", "email", "slack", "telegram"]);
  });

  it("slack disabled without token/channels", () => {
    const ch = createSlackChannel({ channels: { slack: { enabled: true } } });
    assert.equal(ch.enabled, false);
  });

  it("email disabled without hosts", () => {
    const ch = createEmailChannel({ channels: { email: { enabled: true } } });
    assert.equal(ch.enabled, false);
  });

  it("pptx templates pack exists", () => {
    const n = fs.readdirSync("skills/bundled/pptx/templates").filter((f) => f.endsWith(".js"));
    assert.ok(n.length >= 10, `templates ${n.length}`);
  });
});

describe("mergeStatus array/map shapes", () => {
  // Regression (3.95.4): channelManager.status() returns an ARRAY of
  // {name, running, …}, but mergeStatus indexed it like a map keyed by id —
  // array["telegram"] was always undefined, so live status silently never
  // reached the Channels panel (no running/stopped/lastError pills) since
  // the panel shipped in 3.90.0.
  it("merges the real array shape from channelManager.status()", async () => {
    const { mergeStatus } = await import("../src/channels/manage.mjs");
    const inv = { channels: [{ id: "telegram" }, { id: "slack" }] };
    mergeStatus(inv, [
      { name: "telegram", running: true, messagesHandled: 7, lastError: null },
    ]);
    assert.equal(inv.channels[0].status.running, true);
    assert.equal(inv.channels[0].status.messagesHandled, 7);
    assert.equal(inv.channels[1].status, undefined);
  });

  it("still accepts a map keyed by id", async () => {
    const { mergeStatus } = await import("../src/channels/manage.mjs");
    const inv = { channels: [{ id: "discord" }] };
    mergeStatus(inv, { discord: { running: false, lastError: "boom" } });
    assert.equal(inv.channels[0].status.lastError, "boom");
  });
});
