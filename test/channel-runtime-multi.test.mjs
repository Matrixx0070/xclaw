import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeInbound,
  fromSlackMessage,
  fromSlackAppMention,
  fromTelegramUpdate,
  fromDiscordMessage,
  fromEmailMessage,
  fromWebChatMessage,
  processInbound,
} from "../src/channels/runtime.mjs";

function mockReply(calls) {
  return async (opts) => {
    calls.push(opts);
    return {
      text: `echo:${opts.message}`,
      turns: 1,
      identity: `${opts.channel}:${opts.userId}`,
      vaultUserId: `${opts.channel}:${opts.userId}`,
    };
  };
}

describe("normalizeInbound multi-channel", () => {
  it("telegram update", () => {
    const n = fromTelegramUpdate({
      message: {
        message_id: 10,
        text: "hello",
        from: { id: 42, username: "alice", is_bot: false },
        chat: { id: 42 },
      },
    });
    assert.equal(n.channel, "telegram");
    assert.equal(n.userId, "42");
    assert.equal(n.identity, "telegram:42");
    assert.equal(n.text, "hello");
  });

  it("slack message strips bot mention", () => {
    const n = fromSlackMessage(
      { text: "<@UBOT> do stuff", user: "U01" },
      { channelId: "C01", botUserId: "UBOT" }
    );
    assert.equal(n.text, "do stuff");
    assert.equal(n.identity, "slack:U01");
  });

  it("slack app_mention", () => {
    const n = fromSlackAppMention(
      { type: "app_mention", text: "<@UBOT> ping", user: "U02", channel: "C9" },
      { botUserId: "UBOT" }
    );
    assert.equal(n.channel, "slack");
    assert.equal(n.chatId, "C9");
    assert.equal(n.text, "ping");
  });

  it("discord message skips bot flag", () => {
    const n = fromDiscordMessage({
      content: "hi",
      author: { id: "99", bot: true, username: "bot" },
      channel_id: "ch1",
      id: "m1",
    });
    assert.equal(n.isBot, true);
    assert.equal(n.identity, "discord:99");
  });

  it("email from + subject", () => {
    const n = fromEmailMessage({
      from: "User@Example.COM",
      subject: "Help",
      text: "Please fix",
    });
    assert.equal(n.channel, "email");
    assert.equal(n.identity, "email:user@example.com");
    assert.match(n.text, /Subject: Help/);
    assert.match(n.text, /Please fix/);
  });

  it("webchat session", () => {
    const n = fromWebChatMessage({
      message: "/status",
      sessionId: "sess-1",
      userId: "u1",
    });
    assert.equal(n.identity, "webchat:u1");
    assert.equal(n.text, "/status");
  });
});

describe("processInbound multi-channel", () => {
  it("telegram text → agent with userId", async () => {
    const calls = [];
    const inbound = fromTelegramUpdate({
      message: {
        text: "run ls",
        from: { id: 7, is_bot: false },
        chat: { id: 7 },
      },
    });
    const out = await processInbound(inbound, {
      cfg: {},
      replyWithAgent: mockReply(calls),
    });
    assert.equal(out.handled, true);
    assert.equal(out.via, "agent");
    assert.equal(calls[0].channel, "telegram");
    assert.equal(calls[0].userId, "7");
    assert.match(out.reply, /run ls/);
  });

  it("skips bots", async () => {
    const calls = [];
    const inbound = fromDiscordMessage({
      content: "spam",
      author: { id: "1", bot: true },
      channel_id: "c",
    });
    const out = await processInbound(inbound, {
      replyWithAgent: mockReply(calls),
    });
    assert.equal(out.skipped, "bot");
    assert.equal(calls.length, 0);
  });

  it("rate limit short-circuits agent", async () => {
    const calls = [];
    const inbound = normalizeInbound({
      channel: "slack",
      text: "hello",
      userId: "U1",
      chatId: "C1",
    });
    const out = await processInbound(inbound, {
      replyWithAgent: mockReply(calls),
      rateLimiter: { allow: () => ({ ok: false }) },
    });
    assert.equal(out.via, "rate_limit");
    assert.equal(calls.length, 0);
  });

  it("slash command uses handleCommand", async () => {
    const calls = [];
    const inbound = normalizeInbound({
      channel: "telegram",
      text: "/link status",
      userId: "55",
      chatId: "55",
    });
    const out = await processInbound(inbound, {
      cfg: { paths: { configDir: "/tmp/xclaw-cl-test-none" } },
      replyWithAgent: mockReply(calls),
      handleCommand: async () => ({ handled: true, reply: "cmd-ok" }),
    });
    assert.equal(out.via, "command");
    assert.equal(out.reply, "cmd-ok");
    assert.equal(calls.length, 0);
  });

  it("slack app_mention path to agent", async () => {
    const calls = [];
    const inbound = fromSlackAppMention(
      { text: "<@B> help me", user: "U9", channel: "C9" },
      { botUserId: "B" }
    );
    const out = await processInbound(inbound, {
      replyWithAgent: mockReply(calls),
    });
    assert.equal(out.via, "agent");
    assert.equal(calls[0].message, "help me");
    assert.equal(calls[0].userId, "U9");
  });

  it("email path passes email identity", async () => {
    const calls = [];
    const inbound = fromEmailMessage({
      from: "a@b.co",
      subject: "Q",
      text: "body",
    });
    const out = await processInbound(inbound, {
      replyWithAgent: mockReply(calls),
    });
    assert.equal(out.via, "agent");
    assert.equal(calls[0].channel, "email");
    assert.equal(calls[0].userId, "a@b.co");
  });

  it("webchat path", async () => {
    const calls = [];
    const inbound = fromWebChatMessage({
      message: "hi",
      sessionId: "s1",
      userId: "web-user",
    });
    const out = await processInbound(inbound, {
      replyWithAgent: mockReply(calls),
    });
    assert.equal(out.via, "agent");
    assert.equal(calls[0].channel, "webchat");
    assert.equal(calls[0].userId, "web-user");
  });

  it("empty text skipped", async () => {
    const out = await processInbound(
      normalizeInbound({ channel: "slack", text: "  ", userId: "U" }),
      { replyWithAgent: mockReply([]) }
    );
    assert.equal(out.skipped, "empty");
  });
});
