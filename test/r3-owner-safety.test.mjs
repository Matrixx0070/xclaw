import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleChannelCommand } from "../src/channels/commands.mjs";
import { fromTelegramUpdate, fromSlackMessage, normalizeInbound } from "../src/channels/runtime.mjs";

describe("R3 owner safety", () => {
  it("/link blocked in group (not DM)", async () => {
    const out = await handleChannelCommand({
      text: "/link",
      cfg: { paths: { configDir: "/tmp/xclaw-r3-none" }, security: { linkDmOnly: true } },
      channel: "telegram",
      userId: "111",
      chatId: "-100999", // group
      isDm: false,
    });
    assert.equal(out.handled, true);
    assert.match(out.reply, /DM/i);
  });

  it("/link status allowed in group", async () => {
    const out = await handleChannelCommand({
      text: "/link status",
      cfg: { paths: { configDir: "/tmp/xclaw-r3-none2" }, security: { linkDmOnly: true } },
      channel: "telegram",
      userId: "111",
      chatId: "-100999",
      isDm: false,
    });
    assert.equal(out.handled, true);
    assert.doesNotMatch(out.reply, /only works in a \*\*DM\*\*/);
  });

  it("telegram private chat sets isDm", () => {
    const n = fromTelegramUpdate({
      message: {
        text: "hi",
        from: { id: 1 },
        chat: { id: 1, type: "private" },
      },
    });
    assert.equal(n.isDm, true);
  });

  it("slack D-channel is DM", () => {
    const n = fromSlackMessage({ text: "x", user: "U1" }, { channelId: "D0123" });
    assert.equal(n.isDm, true);
  });
});
