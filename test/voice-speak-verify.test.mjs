import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCallConnectedToolTool } from "../src/tools/connected-tools.mjs";

describe("voice_speak", () => {
  it("tiny neural payload plus no local engine is isError, not Neural TTS written", async () => {
    const prev = process.env.TTS_API_KEY;
    process.env.TTS_API_KEY = "test-key";
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      async arrayBuffer() {
        return new Uint8Array([1, 2, 3, 4]).buffer;
      },
    });
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-tts-"));
      const tool = createCallConnectedToolTool({ workingDir: dir, cfg: {} });
      const out = await tool.execute({
        tool_name: "voice_speak",
        arguments: { text: "hello", out: path.join(dir, "artifacts", "audio", "t.wav") },
      });
      const text = out.content[0].text;
      assert.doesNotMatch(text, /Neural TTS written/);
      if (!out.isError) {
        assert.match(text, /Local TTS written/);
      } else {
        assert.match(text, /No TTS engine|transcript/i);
      }
    } finally {
      globalThis.fetch = orig;
      if (prev === undefined) delete process.env.TTS_API_KEY;
      else process.env.TTS_API_KEY = prev;
    }
  });

  it("JSON speech body is not treated as audio", async () => {
    const prev = process.env.TTS_API_KEY;
    process.env.TTS_API_KEY = "test-key";
    const orig = globalThis.fetch;
    const json = Buffer.from('{"error":"nope"}');
    globalThis.fetch = async () => ({
      ok: true,
      headers: { get: () => "application/json" },
      async arrayBuffer() {
        return json.buffer.slice(json.byteOffset, json.byteOffset + json.byteLength);
      },
    });
    try {
      const fs = await import("node:fs");
      const os = await import("node:os");
      const path = await import("node:path");
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-tts-json-"));
      const { createCallConnectedToolTool } = await import("../src/tools/connected-tools.mjs");
      const tool = createCallConnectedToolTool({ workingDir: dir, cfg: {} });
      const out = await tool.execute({
        tool_name: "voice_speak",
        arguments: { text: "hello", out: path.join(dir, "t.mp3") },
      });
      assert.doesNotMatch(out.content[0].text, /Neural TTS written/);
    } finally {
      globalThis.fetch = orig;
      if (prev === undefined) delete process.env.TTS_API_KEY;
      else process.env.TTS_API_KEY = prev;
    }
  });
});
