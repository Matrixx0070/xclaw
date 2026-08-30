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
});
