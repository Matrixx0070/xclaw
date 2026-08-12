import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseOutboundStructured,
  payloadToApiCall,
  sendStructuredOutbound,
} from "../src/channels/telegram/structured-outbound.mjs";

describe("telegram structured outbound P4", () => {
  it("parses location fence and strips it", () => {
    const raw = `Here is the pin:\n\n\`\`\`telegram\n{"type":"location","latitude":24.86,"longitude":67.0}\n\`\`\`\nEnjoy.`;
    const { text, payloads } = parseOutboundStructured(raw);
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].type, "location");
    assert.match(text, /Here is the pin/);
    assert.match(text, /Enjoy/);
    assert.ok(!text.includes("```"));
  });

  it("parses array of payloads", () => {
    const raw = "```tg\n[{\"type\":\"dice\",\"emoji\":\"🎲\"},{\"type\":\"contact\",\"phone\":\"+1\",\"first_name\":\"A\"}]\n```";
    const { payloads } = parseOutboundStructured(raw);
    assert.equal(payloads.length, 2);
  });

  it("payloadToApiCall location/venue/contact/poll", () => {
    const loc = payloadToApiCall(
      { type: "location", latitude: 1, longitude: 2 },
      10,
      5
    );
    assert.equal(loc.method, "sendLocation");
    assert.equal(loc.body.latitude, 1);
    assert.equal(loc.body.reply_to_message_id, 5);

    const venue = payloadToApiCall(
      { type: "venue", lat: 1, lon: 2, title: "Cafe", address: "St" },
      10
    );
    assert.equal(venue.method, "sendVenue");

    const contact = payloadToApiCall(
      { type: "contact", phone: "+100", firstName: "Ada" },
      10
    );
    assert.equal(contact.method, "sendContact");
    assert.equal(contact.body.phone_number, "+100");

    const poll = payloadToApiCall(
      { type: "poll", question: "Ship?", options: ["Yes", "No"] },
      10
    );
    assert.equal(poll.method, "sendPoll");
    assert.equal(poll.body.options.length, 2);
  });

  it("rejects invalid location", () => {
    assert.equal(
      payloadToApiCall({ type: "location", latitude: "x" }, 1),
      null
    );
  });

  it("sendStructuredOutbound calls api", async () => {
    const calls = [];
    const api = async (method, body) => {
      calls.push({ method, body });
      return {};
    };
    const r = await sendStructuredOutbound({
      api,
      chatId: 42,
      payloads: [
        { type: "location", latitude: 1, longitude: 2 },
        { type: "dice" },
        { type: "nope" },
      ],
    });
    assert.equal(r.sent, 2);
    assert.equal(r.errors.length, 1);
    assert.equal(calls[0].method, "sendLocation");
    assert.equal(calls[1].method, "sendDice");
  });

  it("sticker/photo need file_id string", () => {
    assert.equal(payloadToApiCall({ type: "sticker" }, 1), null);
    const s = payloadToApiCall({ type: "sticker", file_id: "FILE" }, 1);
    assert.equal(s.method, "sendSticker");
    const ph = payloadToApiCall({ type: "photo", fileId: "P" }, 1);
    assert.equal(ph.method, "sendPhoto");
  });
});
