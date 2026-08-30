import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGenerateImageTool } from "../src/tools/image-tools.mjs";

describe("generate_image verifies the file landed", () => {
  const prev = process.env.XAI_API_KEY;
  after(() => {
    if (prev === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = prev;
  });

  it("rejects a tiny b64 payload instead of claiming Generated", async () => {
    process.env.XAI_API_KEY = "test-key";
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      async json() {
        return { data: [{ b64_json: Buffer.from("tiny").toString("base64") }] };
      },
    });
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-genimg-"));
      const tool = createGenerateImageTool({ workingDir: dir, cfg: {} });
      const out = await tool.execute({ prompt: "a red square" });
      assert.equal(out.isError, true);
      assert.match(out.content[0].text, /too small|failed/i);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("succeeds when the payload is large enough and re-reads", async () => {
    process.env.XAI_API_KEY = "test-key";
    const orig = globalThis.fetch;
    const payload = Buffer.alloc(128, 0x89);
    globalThis.fetch = async () => ({
      ok: true,
      async json() {
        return { data: [{ b64_json: payload.toString("base64") }] };
      },
    });
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-genimg-ok-"));
      const tool = createGenerateImageTool({ workingDir: dir, cfg: {} });
      const out = await tool.execute({ prompt: "a red square" });
      assert.ok(!out.isError, JSON.stringify(out).slice(0, 200));
      assert.match(out.content[0].text, /Generated:/);
      const dest = out.content[0].text.replace(/^Generated:\s*/, "").trim();
      assert.equal(fs.statSync(dest).size, 128);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
