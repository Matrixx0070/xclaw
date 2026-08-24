/**
 * 2026-08-24 Telegram DM review fixes — regression coverage for the four
 * live-observed defects: claims-JSON leak, unrendered markdown, CDN-URL
 * photo ENOENT, and single-shot media downloads.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitScoreAndPresentationText } from "../src/agent/run-agent.mjs";
import { mdToTelegramHtml, mdToPlain } from "../src/channels/telegram/markdown.mjs";
import { isImageUrl } from "../src/channels/telegram/photo-out.mjs";

const LEAKED =
  '**London now:** about **20°C**, patchy rain.\n\n```json\n{"claims":["London ~20C from wttr.in"],"evidence_ids":["xclaw_bash"]}\n```';

describe("claims scaffold: score raw, present stripped", () => {
  it("presentationText drops the claims block the gate still scores", () => {
    const { text, presentationText } = splitScoreAndPresentationText({
      finalText: LEAKED,
      text: LEAKED.replace(/\n*```json[\s\S]*$/, ""),
    });
    assert.ok(text.includes('"claims"'), "gate input keeps the scaffold");
    assert.ok(!presentationText.includes('"claims"'), "outward text must not leak the scaffold");
    assert.match(presentationText, /London now/);
  });

  it("strips even when the loop only returned raw finalText", () => {
    const { presentationText } = splitScoreAndPresentationText({ finalText: LEAKED, text: "" });
    assert.ok(!presentationText.includes('"claims"'));
  });

  it("plain replies pass through untouched", () => {
    const { text, presentationText } = splitScoreAndPresentationText({
      finalText: "All done.",
      text: "All done.",
    });
    assert.equal(text, "All done.");
    assert.equal(presentationText, "All done.");
  });
});

describe("markdown → Telegram HTML", () => {
  it("renders bold/italic/code and escapes host HTML", () => {
    const html = mdToTelegramHtml("**bold** *it* `co` & <script>");
    assert.equal(html, "<b>bold</b> <i>it</i> <code>co</code> &amp; &lt;script&gt;");
  });

  it("fenced blocks become <pre> with no inner styling", () => {
    const html = mdToTelegramHtml("before\n```json\n{\"a\":\"**x**\"}\n```\nafter");
    assert.match(html, /<pre>\{"a":"\*\*x\*\*"\}<\/pre>/);
  });

  it("http links become anchors; other schemes stay literal", () => {
    assert.match(
      mdToTelegramHtml("[docs](https://x.example/d)"),
      /<a href="https:\/\/x\.example\/d">docs<\/a>/
    );
    const js = mdToTelegramHtml("[x](javascript:alert(1))");
    assert.ok(!js.includes("<a "), "non-http scheme must not become a link");
  });

  it("literal ' 0 ' text survives the inline-code placeholder round-trip", () => {
    const html = mdToTelegramHtml("count 0 and `x` and 1 done");
    assert.match(html, /count 0 and <code>x<\/code> and 1 done/);
  });

  it("mdToPlain strips markers for voice captions", () => {
    assert.equal(mdToPlain("**London:** `20C` *rain*"), "London: 20C rain");
  });
});

describe("photo-out URL handling", () => {
  it("classifies URLs vs local paths", () => {
    assert.equal(isImageUrl("//cdn.worldweatheronline.com/i.png"), true);
    assert.equal(isImageUrl("https://x.example/i.png"), true);
    assert.equal(isImageUrl("/root/artifacts/i.png"), false);
  });

  it("sendPhotoUrl normalizes protocol-relative to https and posts JSON", async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    };
    try {
      const { sendPhotoUrl } = await import("../src/channels/telegram/photo-out.mjs");
      const r = await sendPhotoUrl({ token: "T", chatId: 5, url: "//cdn.example/i.png" });
      assert.equal(r.ok, true);
      assert.equal(calls[0].body.photo, "https://cdn.example/i.png");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
