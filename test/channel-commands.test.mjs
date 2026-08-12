import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleChannelCommand } from "../src/channels/commands.mjs";

describe("channel commands", () => {
  it("help is handled", async () => {
    const r = await handleChannelCommand({ text: "/help", cfg: {} });
    assert.equal(r.handled, true);
    assert.ok(r.reply.includes("/job"));
  });
  it("non-command ignored", async () => {
    const r = await handleChannelCommand({ text: "hello", cfg: {} });
    assert.equal(r.handled, false);
  });
});
