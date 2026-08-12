import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  recordTelegramUpdate,
  recordTelegramEdit,
  recordTelegramDeny,
  recordTelegramStreamDelta,
  renderTelegramMetrics,
  resetTelegramMetrics,
} from "../src/channels/telegram/metrics.mjs";
import { createTelegramStreamer } from "../src/channels/telegram/stream.mjs";

describe("telegram metrics P1", () => {
  it("renders counters", () => {
    resetTelegramMetrics();
    recordTelegramUpdate("message");
    recordTelegramUpdate("callback_query");
    recordTelegramEdit("ok");
    recordTelegramDeny("allowlist");
    recordTelegramStreamDelta();
    const text = renderTelegramMetrics();
    assert.match(text, /xclaw_telegram_updates_total/);
    assert.match(text, /kind="message"/);
    assert.match(text, /xclaw_telegram_stream_deltas_total/);
  });
});

describe("telegram setPartial", () => {
  it("throttles partial edits", async () => {
    const edits = [];
    const api = async (method, body) => {
      if (method === "sendMessage") return { message_id: 9 };
      if (method === "editMessageText") {
        edits.push(body.text);
        return true;
      }
    };
    const s = createTelegramStreamer({
      api,
      chatId: 1,
      minEditIntervalMs: 50,
    });
    await s.sendPlaceholder();
    await s.setPartial("Hel");
    await s.setPartial("Hello");
    await s.setPartial("Hello world");
    await new Promise((r) => setTimeout(r, 80));
    await s.finish("Hello world!");
    assert.ok(edits.length >= 1);
    assert.equal(edits[edits.length - 1], "Hello world!");
    s.close();
  });
});
