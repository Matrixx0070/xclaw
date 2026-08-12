import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  messageMentionsBot,
  gateGroupMessage,
  stripBotMention,
  groupPolicyOptions,
} from "../src/channels/telegram/group-policy.mjs";
import {
  isVoiceOutEnabled,
  voiceOutOptions,
} from "../src/channels/telegram/voice-out.mjs";

const bot = { id: 99, username: "xxclaw_bot" };

describe("telegram group policy P2", () => {
  it("requires mention in groups by default", () => {
    const msg = {
      chat: { id: -100, type: "supergroup" },
      text: "hello without mention",
      from: { id: 1 },
    };
    const r = gateGroupMessage({ msg, conf: {}, botInfo: bot });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "mention_required");
  });

  it("allows when @mentioned", () => {
    const msg = {
      chat: { id: -100, type: "supergroup" },
      text: "hey @xxclaw_bot do stuff",
      entities: [{ type: "mention", offset: 4, length: 11 }],
      from: { id: 1 },
    };
    const r = gateGroupMessage({ msg, conf: {}, botInfo: bot });
    assert.equal(r.ok, true);
  });

  it("allows DM without mention", () => {
    const msg = {
      chat: { id: 1, type: "private" },
      text: "hi",
      from: { id: 1 },
    };
    const r = gateGroupMessage({ msg, conf: {}, botInfo: bot });
    assert.equal(r.ok, true);
  });

  it("allowlist policy blocks unknown groups", () => {
    const msg = {
      chat: { id: -200, type: "group" },
      text: "@xxclaw_bot hi",
      entities: [{ type: "mention", offset: 0, length: 11 }],
      from: { id: 1 },
    };
    const r = gateGroupMessage({
      msg,
      conf: { groups: { policy: "allowlist", allowedGroupIds: ["-100"] } },
      botInfo: bot,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "group_not_allowlisted");
  });

  it("topic requireMention override", () => {
    const msg = {
      chat: { id: -100, type: "supergroup" },
      message_thread_id: 7,
      text: "no mention",
      from: { id: 1 },
    };
    const r = gateGroupMessage({
      msg,
      conf: {
        groups: {
          policy: "open",
          topics: { "7": { requireMention: true } },
        },
      },
      botInfo: bot,
    });
    // policy open but topic forces mention
    assert.equal(r.ok, false);
  });

  it("stripBotMention", () => {
    assert.equal(stripBotMention("hi @xxclaw_bot there", bot), "hi there");
  });

  it("messageMentionsBot via reply", () => {
    const msg = {
      text: "yes",
      reply_to_message: { from: { id: 99, is_bot: true } },
    };
    assert.equal(messageMentionsBot(msg, bot), true);
  });
});

describe("telegram voice out P2", () => {
  it("opt-in disabled by default", () => {
    assert.equal(isVoiceOutEnabled({}), false);
    assert.equal(isVoiceOutEnabled({ voiceOut: { enabled: true } }), true);
  });

  it("voiceOutOptions modes", () => {
    const o = voiceOutOptions({ voiceOut: { enabled: true, mode: "always", maxChars: 100 } });
    assert.equal(o.mode, "always");
    assert.equal(o.maxChars, 100);
  });
});
