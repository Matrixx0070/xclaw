import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chunkText,
  prepareReplyChunks,
  splitHeadAndOverflow,
  utf16Len,
  findChunkEnd,
  clampToCodePointBoundary,
  wouldSplitSurrogate,
  isHighSurrogate,
} from "../src/channels/telegram/chunk-text.mjs";
import { createTelegramStreamer } from "../src/channels/telegram/stream.mjs";

describe("surrogate helpers", () => {
  it("clampToCodePointBoundary end mode", () => {
    const rocket = "🚀"; // 2 units
    const s = "ab" + rocket + "cd";
    // index after high surrogate only (between pair)
    const mid = 2 + 1; // points at low surrogate index
    assert.equal(s.charCodeAt(mid - 1) >= 0xd800, true);
    const clamped = clampToCodePointBoundary(s, mid, "end");
    assert.equal(clamped, 2); // back before the pair
    assert.equal(wouldSplitSurrogate(s, 0, mid), true);
    assert.equal(wouldSplitSurrogate(s, 0, clamped), false);
  });

  it("clamp start mode does not start on low surrogate", () => {
    const s = "x🚀y";
    const lowIdx = 2; // low surrogate of rocket
    assert.ok(s.charCodeAt(lowIdx) >= 0xdc00);
    assert.equal(clampToCodePointBoundary(s, lowIdx, "start"), 1);
  });
});

describe("chunkText", () => {
  it("returns single chunk when under max", () => {
    assert.deepEqual(chunkText("hello", 4000), ["hello"]);
  });

  it("splits on newlines when possible", () => {
    const a = "A".repeat(100);
    const b = "B".repeat(100);
    const text = a + "\n" + b;
    const parts = chunkText(text, 120);
    assert.ok(parts.length >= 2);
    assert.equal(parts.join(""), text);
  });

  it("never exceeds max per chunk", () => {
    const text = "x".repeat(10_000);
    const parts = chunkText(text, 4000);
    for (const p of parts) {
      assert.ok(utf16Len(p) <= 4000);
    }
    assert.equal(parts.join(""), text);
  });

  it("never splits surrogate pairs across chunks", () => {
    // Fill with emoji so almost every boundary is a pair
    const rocket = "🚀";
    const text = rocket.repeat(3000); // 6000 units
    const parts = chunkText(text, 4000);
    assert.equal(parts.join(""), text);
    for (const p of parts) {
      assert.ok(utf16Len(p) <= 4000);
      // no leading low surrogate
      if (p.length) {
        const first = p.charCodeAt(0);
        assert.ok(!(first >= 0xdc00 && first <= 0xdfff));
      }
      // no trailing high surrogate
      if (p.length) {
        const last = p.charCodeAt(p.length - 1);
        assert.ok(!(last >= 0xd800 && last <= 0xdbff));
      }
    }
  });

  it("handles emoji at exact max boundary", () => {
    const rocket = "🚀";
    // 9 ASCII + rocket would be 11 units; max 10 must not split rocket
    const text = "a".repeat(9) + rocket + "b".repeat(50);
    const end = findChunkEnd(text, 0, 10);
    const head = text.slice(0, end);
    assert.ok(!isHighSurrogate(head.charCodeAt(head.length - 1)) || end === text.length);
    assert.equal(wouldSplitSurrogate(text, 0, end), false);
    const parts = chunkText(text, 10);
    assert.equal(parts.join(""), text);
    for (const p of parts) assert.ok(utf16Len(p) <= 10 || p.includes("🚀"));
  });

  it("ZWJ family emoji stays intact when possible", () => {
    // Family emoji is multiple code points / units; hard split may still break graphemes
    // but must not break UTF-16 pairs inside
    const family = "👨‍👩‍👧‍👦";
    const text = "n".repeat(20) + family + "n".repeat(20);
    const parts = chunkText(text, 25);
    assert.equal(parts.join(""), text);
    for (const p of parts) {
      if (p.length) {
        const last = p.charCodeAt(p.length - 1);
        const first = p.charCodeAt(0);
        assert.ok(!(last >= 0xd800 && last <= 0xdbff));
        assert.ok(!(first >= 0xdc00 && first <= 0xdfff));
      }
    }
  });
});

describe("prepareReplyChunks", () => {
  it("truncates total then chunks surrogate-safe", () => {
    const text = "🚀".repeat(8000);
    const parts = prepareReplyChunks(text, { chunkMax: 4000, totalMax: 10_000 });
    const joined = parts.join("");
    assert.ok(utf16Len(joined) <= 10_000 + 20); // ellipsis
    assert.match(joined, /truncated/);
    // truncated body before ellipsis should not end with lone high surrogate
    const body = joined.replace(/\n?…\(truncated\)$/, "");
    if (body.length) {
      const last = body.charCodeAt(body.length - 1);
      assert.ok(!(last >= 0xd800 && last <= 0xdbff));
    }
  });
});

describe("splitHeadAndOverflow", () => {
  it("head only when short", () => {
    const { head, overflow } = splitHeadAndOverflow("hi", 100);
    assert.equal(head, "hi");
    assert.equal(overflow.length, 0);
  });

  it("overflow for long text", () => {
    const text = "M".repeat(9000);
    const { head, overflow } = splitHeadAndOverflow(text, 4000);
    assert.ok(utf16Len(head) <= 4000);
    assert.ok(overflow.length >= 1);
    assert.equal([head, ...overflow].join(""), text);
  });
});

describe("streamer finish overflow", () => {
  it("edits head and sends overflow messages", async () => {
    const calls = [];
    const api = async (method, body) => {
      calls.push({ method, text: body.text });
      if (method === "sendMessage") return { message_id: calls.length };
      return true;
    };
    const s = createTelegramStreamer({
      api,
      chatId: 1,
      maxLen: 100,
      minEditIntervalMs: 10,
    });
    await s.sendPlaceholder();
    const long = "line\n".repeat(50);
    const result = await s.finish(long);
    assert.ok(result.overflowSent >= 1);
    s.close();
  });
});
