import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasStructuredContent,
  extractStructuredInbound,
  structuredToAgentHint,
} from "../src/channels/telegram/structured-inbound.mjs";

describe("telegram structured inbound P3", () => {
  it("detects sticker/location/contact", () => {
    assert.equal(hasStructuredContent({ sticker: { emoji: "😀" } }), true);
    assert.equal(hasStructuredContent({ location: { latitude: 1, longitude: 2 } }), true);
    assert.equal(hasStructuredContent({ contact: { phone_number: "1" } }), true);
    assert.equal(hasStructuredContent({ text: "hi" }), false);
  });

  it("extracts sticker", () => {
    const { textParts, structured } = extractStructuredInbound({
      sticker: {
        emoji: "🚀",
        set_name: "Space",
        file_id: "ABC",
        is_animated: false,
      },
    });
    assert.equal(structured[0].type, "sticker");
    assert.equal(structured[0].emoji, "🚀");
    assert.match(textParts[0], /Sticker/);
  });

  it("extracts location", () => {
    const { textParts, structured } = extractStructuredInbound({
      location: { latitude: 24.86, longitude: 67.0 },
    });
    assert.equal(structured[0].type, "location");
    assert.match(textParts[0], /24\.86/);
  });

  it("extracts venue over plain location", () => {
    const { structured } = extractStructuredInbound({
      location: { latitude: 1, longitude: 2 },
      venue: {
        title: "Cafe",
        address: "Main St",
        location: { latitude: 1, longitude: 2 },
      },
    });
    assert.equal(structured.length, 1);
    assert.equal(structured[0].type, "venue");
    assert.equal(structured[0].title, "Cafe");
  });

  it("extracts contact and poll", () => {
    const c = extractStructuredInbound({
      contact: { phone_number: "+100", first_name: "Ada", last_name: "L" },
    });
    assert.equal(c.structured[0].type, "contact");
    const p = extractStructuredInbound({
      poll: {
        question: "Ship it?",
        options: [{ text: "Yes" }, { text: "No" }],
        type: "regular",
      },
    });
    assert.equal(p.structured[0].type, "poll");
    assert.match(p.textParts.join("\n"), /Ship it/);
  });

  it("structuredToAgentHint JSON", () => {
    const hint = structuredToAgentHint([
      { type: "location", latitude: 1, longitude: 2 },
    ]);
    assert.match(hint, /telegramStructured/);
    assert.match(hint, /"location"/);
  });
});
