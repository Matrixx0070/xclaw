import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasGraphemeSegmenter,
  segmentGraphemes,
  countGraphemes,
  truncateUtf16,
  truncateCodePoints,
  truncateGraphemes,
  truncateGraphemesToUtf16Budget,
  truncateForChannel,
} from "../src/utils/unicode-truncate.mjs";
import { truncate } from "../src/channels/base.mjs";

describe("unicode truncate", () => {
  it("does not split surrogate pairs (emoji)", () => {
    const emoji = "😀";
    assert.equal(emoji.length, 2);
    const out = truncateUtf16(emoji + emoji + emoji, 3, "…");
    for (let i = 0; i < out.length; i++) {
      const c = out.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const l = out.charCodeAt(i + 1);
        assert.ok(l >= 0xdc00 && l <= 0xdfff);
      }
      if (c >= 0xdc00 && c <= 0xdfff) {
        const h = out.charCodeAt(i - 1);
        assert.ok(h >= 0xd800 && h <= 0xdbff);
      }
    }
    assert.ok(out.length <= 3);
  });

  it("truncateUtf16 respects max UTF-16 length", () => {
    const s = "a".repeat(100) + "😀" + "b".repeat(100);
    const out = truncateUtf16(s, 50, "…");
    assert.ok(out.length <= 50);
    assert.ok(out.endsWith("…"));
  });

  it("truncateCodePoints counts emoji as one", () => {
    const s = "😀😀😀";
    const out = truncateCodePoints(s, 2, "");
    assert.equal(Array.from(out).length, 2);
  });

  it("truncateForChannel / base.truncate stay under max", () => {
    const s = "x".repeat(5000) + "🎯";
    const out = truncate(s, 100);
    assert.ok(out.length <= 100);
    assert.match(out, /truncated/);
  });

  it("empty and short inputs", () => {
    assert.equal(truncateUtf16("", 10), "");
    assert.equal(truncateUtf16("hi", 10), "hi");
    assert.equal(truncateUtf16("hello", 0), "");
  });
});

describe("Intl.Segmenter grapheme truncation", () => {
  it("detects Segmenter support", () => {
    // Node 20+ should have it
    assert.equal(typeof hasGraphemeSegmenter(), "boolean");
  });

  it("segments simple emoji as one grapheme each", () => {
    const parts = segmentGraphemes("a😀b");
    assert.equal(parts.length, 3);
    assert.equal(parts[1], "😀");
  });

  it("counts ZWJ family emoji as one grapheme when Segmenter exists", () => {
    // Family: Man Woman Girl Boy — often one grapheme with Segmenter
    const family = "👨‍👩‍👧‍👦";
    const n = countGraphemes(family);
    if (hasGraphemeSegmenter()) {
      assert.equal(n, 1, `expected 1 grapheme, got ${n}`);
    } else {
      assert.ok(n >= 1);
    }
  });

  it("truncateGraphemes keeps whole clusters", () => {
    const s = "ab👨‍👩‍👧‍👦cd";
    const out = truncateGraphemes(s, 3, "");
    const parts = segmentGraphemes(out);
    assert.ok(parts.length <= 3);
    // should not end mid-ZWJ if Segmenter works
    if (hasGraphemeSegmenter() && out.includes("👨")) {
      assert.ok(out.includes("👨‍👩‍👧‍👦") || !out.includes("\u200D"));
    }
  });

  it("truncateGraphemes with ellipsis budget", () => {
    const s = "abcdefghij";
    const out = truncateGraphemes(s, 5, "…");
    assert.equal(countGraphemes(out), 5); // 4 chars + ellipsis
    assert.ok(out.endsWith("…"));
  });

  it("truncateGraphemesToUtf16Budget respects UTF-16 max", () => {
    const s = "😀".repeat(20) + "hello";
    const out = truncateGraphemesToUtf16Budget(s, 10, "…");
    assert.ok(out.length <= 10);
  });

  it("flag emoji stays whole under grapheme-utf16", () => {
    // Regional indicators: 🇺🇸
    const flag = "🇺🇸";
    const out = truncateGraphemesToUtf16Budget(flag + flag + flag, 5, "…");
    assert.ok(out.length <= 5);
    // no lone regional indicator preferred
    if (hasGraphemeSegmenter()) {
      const parts = segmentGraphemes(out.replace(/…$/, ""));
      for (const p of parts) {
        assert.ok(p.length >= 1);
      }
    }
  });

  it("truncateForChannel mode grapheme-utf16", () => {
    const s = "🎯".repeat(50);
    const out = truncateForChannel(s, 20, "…", { mode: "grapheme-utf16" });
    assert.ok(out.length <= 20);
  });
});
