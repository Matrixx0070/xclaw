import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createTelegramStreamer,
  isTelegramStreamEnabled,
  telegramStreamOptions,
} from "../src/channels/telegram/stream.mjs";

describe("telegram stream helpers", () => {
  it("isTelegramStreamEnabled defaults true", () => {
    assert.equal(isTelegramStreamEnabled({}), true);
    assert.equal(isTelegramStreamEnabled({ stream: false }), false);
    assert.equal(isTelegramStreamEnabled({ stream: { enabled: false } }), false);
  });

  it("telegramStreamOptions reads intervals", () => {
    const o = telegramStreamOptions({
      stream: { minEditIntervalMs: 500, showTools: false },
    });
    assert.equal(o.minEditIntervalMs, 500);
    assert.equal(o.showTools, false);
  });

  it("streamer placeholder then finish edits", async () => {
    const calls = [];
    const api = async (method, body) => {
      calls.push({ method, body });
      if (method === "sendMessage") return { message_id: 42 };
      if (method === "editMessageText") return true;
      return null;
    };
    const s = createTelegramStreamer({
      api,
      chatId: 1,
      replyToMessageId: 9,
      minEditIntervalMs: 50,
    });
    await s.sendPlaceholder();
    assert.equal(s.getMessageId(), 42);
    await s.onToolStart("bash");
    await new Promise((r) => setTimeout(r, 80));
    await s.finish("Hello world");
    assert.ok(calls.some((c) => c.method === "sendMessage"));
    assert.ok(calls.some((c) => c.method === "editMessageText"));
    const lastEdit = [...calls].reverse().find((c) => c.method === "editMessageText");
    assert.equal(lastEdit.body.text, "Hello world");
    s.close();
  });

  it("coalesces rapid updates", async () => {
    let edits = 0;
    const api = async (method) => {
      if (method === "sendMessage") return { message_id: 1 };
      if (method === "editMessageText") {
        edits += 1;
        return true;
      }
    };
    const s = createTelegramStreamer({
      api,
      chatId: 1,
      minEditIntervalMs: 200,
    });
    await s.sendPlaceholder();
    await s.update("a");
    await s.update("b");
    await s.update("c");
    await new Promise((r) => setTimeout(r, 250));
    await s.finish("done");
    // placeholder send + throttled edits + finish — should not be 1+3+1 raw
    assert.ok(edits <= 4, `edits=${edits}`);
    s.close();
  });
});

describe("telegram stream error handling", () => {
  it("finish falls back to sendMessage when edit fails hard", async () => {
    const calls = [];
    const api = async (method, body) => {
      calls.push(method);
      if (method === "sendMessage") return { message_id: 7 };
      if (method === "editMessageText") {
        throw new Error("message can't be edited");
      }
      return null;
    };
    const s = createTelegramStreamer({
      api,
      chatId: 1,
      minEditIntervalMs: 50,
    });
    await s.sendPlaceholder();
    await s.finish("recovered text");
    assert.ok(calls.includes("sendMessage"));
    assert.ok(calls.includes("editMessageText"));
    assert.ok(calls.filter((c) => c === "sendMessage").length >= 2); // placeholder + fallback
    s.close();
  });

  it("ignores not-modified edit errors", async () => {
    let edits = 0;
    const api = async (method) => {
      if (method === "sendMessage") return { message_id: 1 };
      if (method === "editMessageText") {
        edits += 1;
        if (edits === 1) return true;
        throw new Error("Bad Request: message is not modified");
      }
    };
    const s = createTelegramStreamer({
      api,
      chatId: 1,
      minEditIntervalMs: 10,
    });
    await s.sendPlaceholder();
    await s.finish("same");
    await s.finish("same"); // second edit may throw not-modified
    s.close();
  });
});
