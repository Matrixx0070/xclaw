/**
 * toSpeakableText — TTS input sanitation. Voice replies were vocalizing
 * markdown bullets, asterisks, parens and URLs (2026-08-24).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toSpeakableText } from "../src/voice/speakable.mjs";

describe("toSpeakableText", () => {
  it("keeps sentence punctuation for prosody", () => {
    assert.equal(toSpeakableText("Hello, world. All good!"), "Hello, world. All good!");
  });

  it("strips markdown emphasis and inline code markers", () => {
    assert.equal(toSpeakableText("**bold** and *it* and `code`"), "bold and it and code");
  });

  it("turns bullets and headings into sentences", () => {
    const out = toSpeakableText("## Plan\n- first step\n- second step\n1. third");
    assert.equal(out, "Plan. first step, second step, third");
  });

  it("drops code blocks and speaks a marker instead", () => {
    const out = toSpeakableText('before\n```json\n{"claims":[1]}\n```\nafter');
    assert.ok(!out.includes("claims"));
    assert.match(out, /Code omitted/);
  });

  it("URLs collapse to the hostname, links to their label", () => {
    assert.equal(toSpeakableText("see [the docs](https://github.com/x/y)"), "see the docs");
    assert.equal(toSpeakableText("go to https://example.com/a/b?q=1 now"), "go to example.com now");
  });

  it("parens become pauses, emoji and symbol noise vanish", () => {
    const out = toSpeakableText("20°C (feels like 16°C) 🚀 #great");
    assert.equal(out, "20°C, feels like 16°C, great");
  });

  it("maxChars cuts at a sentence boundary, not mid-word", () => {
    const out = toSpeakableText("First sentence here. Second sentence is much longer than needed.", {
      maxChars: 30,
    });
    assert.equal(out, "First sentence here.");
  });

  it("weather-style reply reads naturally", () => {
    const out = toSpeakableText(
      "**London now:** about **20°C** (feels like **16°C**), **patchy rain nearby**, **56%** humidity."
    );
    assert.equal(out, "London now: about 20°C, feels like 16°C, patchy rain nearby, 56% humidity.");
  });
});
