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
