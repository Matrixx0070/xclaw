import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeBinaryFrame, createFrameParser } from "../src/gateway/ws-hub.mjs";
import { pcmToWav } from "../src/voice/vad.mjs";

describe("voice PCM websocket framing", () => {
  it("encodeBinaryFrame is opcode binary", () => {
    const frame = encodeBinaryFrame(Buffer.from([1, 2, 3, 4]));
    assert.equal(frame[0] & 0x0f, 0x2);
    assert.equal(frame[0] & 0x80, 0x80);
  });

  it("parser accepts binary payload", () => {
    const payload = Buffer.alloc(64, 7);
    const mask = Buffer.from([1, 2, 3, 4]);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
    const header = Buffer.alloc(6);
    header[0] = 0x82;
    header[1] = 0x80 | payload.length; // masked + len < 126
    mask.copy(header, 2);
    const frame = Buffer.concat([header, masked]);
    const parser = createFrameParser({ requireMask: true });
    const { messages, error } = parser.push(frame);
    assert.equal(error, null);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "binary");
    assert.ok(Buffer.compare(messages[0].data, payload) === 0);
  });

  it("pcmToWav for STT path", () => {
    const wav = pcmToWav(Buffer.alloc(3200), 16000);
    assert.equal(wav.toString("utf8", 0, 4), "RIFF");
  });
});
