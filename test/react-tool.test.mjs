/**
 * `react` tool wiring (spec §16.3, v3.265.0) — tool plans through
 * planGlyphAction and calls the channel adapter; registry advertises it
 * ONLY when a react-capable channelContext is present; the context is
 * plumbed telegram → processInbound → replyWithAgent → runAgent → loop;
 * Telegram payloads set the whole reaction list (empty = clear).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { createReactTool } from "../src/channels/react-tool.mjs";
import { buildReactionCall } from "../src/channels/telegram/react.mjs";
import { createAllLocalTools } from "../src/tools/registry.mjs";

function fakeContext(calls, channel = "telegram") {
  return {
    channel,
    messageId: "111",
    adapter: {
      react: async (args) => {
        calls.push(args);
        return { ok: true, delivered: true };
      },
    },
  };
}

describe("react tool (spec §16.3)", () => {
  it("adds an emoji to the current message by default; explicit messageId wins", async () => {
    const calls = [];
    const tool = createReactTool(fakeContext(calls));
    assert.equal(tool.name, "react");
    const r1 = await tool.execute({ emoji: "👍" });
    assert.equal(r1.ok, true);
    const r2 = await tool.execute({ emoji: "🔥", messageId: "222" });
    assert.equal(r2.ok, true);
    assert.deepEqual(calls, [
      { messageId: "111", ok: true, op: "add", emoji: "👍" },
      { messageId: "222", ok: true, op: "add", emoji: "🔥" },
    ]);
  });

  it("empty emoji clears; remove removes; whatsapp context replaces (per-channel plan rules)", async () => {
    const tgCalls = [];
    const tg = createReactTool(fakeContext(tgCalls));
    await tg.execute({ emoji: "" });
    await tg.execute({ emoji: "👍", remove: true });
    assert.deepEqual(
      tgCalls.map((c) => c.op),
      ["clear-all", "remove"],
    );
    const waCalls = [];
    const wa = createReactTool(fakeContext(waCalls, "whatsapp"));
    await wa.execute({ emoji: "❤️" });
    assert.equal(waCalls[0].op, "replace");
  });

  it("returns ok:false (not a throw) on a bad plan or missing adapter", async () => {
    const tool = createReactTool({ channel: "nextcloud", messageId: "1", adapter: { react: async () => ({}) } });
    const bad = await tool.execute({ emoji: "" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /only supports adding/);
    const noAdapter = createReactTool({ channel: "telegram", messageId: "1", adapter: {} });
    const miss = await noAdapter.execute({ emoji: "👍" });
    assert.equal(miss.ok, false);
    assert.match(miss.error, /has no react adapter/);
  });

  it("registry advertises react ONLY with a react-capable channelContext", () => {
    const without = createAllLocalTools({ cfg: {} });
    assert.equal(without.some((t) => t.name === "react"), false);
    const withCtx = createAllLocalTools({
      cfg: {},
      channelContext: { channel: "telegram", messageId: "1", adapter: { react: async () => ({}) } },
    });
    assert.equal(withCtx.some((t) => t.name === "react"), true);
  });

  it("telegram reaction call sets the whole list: add = one emoji, remove/clear = empty", () => {
    assert.deepEqual(buildReactionCall({ chatId: 5, messageId: "9", op: "add", emoji: "👍" }), {
      method: "setMessageReaction",
      body: { chat_id: 5, message_id: 9, reaction: [{ type: "emoji", emoji: "👍" }] },
    });
    for (const op of ["remove", "clear-all", "clear-one"]) {
      assert.deepEqual(buildReactionCall({ chatId: 5, messageId: 9, op, emoji: "👍" }).body.reaction, []);
    }
  });

  it("channelContext is plumbed through every hop and ack stays default-off", () => {
    const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
    const tg = read("../src/channels/telegram/index.mjs");
    assert.match(tg, /buildReactionCall\(/);
    assert.match(tg, /channelContext,/);
    const ackIdx = tg.indexOf("const ackGlyph = resolveAckGlyph({");
    assert.ok(ackIdx > -1, "ack glyph resolved from channel config");
    assert.match(tg.slice(ackIdx), /if \(ackGlyph\) \{/);
    assert.match(read("../src/channels/runtime.mjs"), /channelContext: opts\.channelContext/);
    assert.match(read("../src/channels/base.mjs"), /\.\.\.\(channelContext \? \{ channelContext \} : \{\}\)/);
    assert.match(read("../src/agent/run-agent.mjs"), /channelContext: req\.channelContext \|\| null/);
    const loop = read("../src/agent/loop.mjs");
    assert.equal(
      (loop.match(/createAllLocalTools\(\{ workingDir, cfg, computer, sessionId, channelContext \}\)/g) || []).length,
      2,
      "both loop tool sites pass channelContext",
    );
  });
});
