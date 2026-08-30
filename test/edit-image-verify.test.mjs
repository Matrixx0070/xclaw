import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertImageLanded, createEditImageTool } from "../src/tools/image-tools.mjs";

describe("edit_image / assertImageLanded", () => {
  it("assertImageLanded rejects missing and tiny files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-img-"));
    await assert.rejects(() => assertImageLanded(path.join(dir, "nope.png")), /missing/);
    const tiny = path.join(dir, "tiny.png");
    fs.writeFileSync(tiny, "x");
    await assert.rejects(() => assertImageLanded(tiny), /too small/);
    const ok = path.join(dir, "ok.png");
    fs.writeFileSync(ok, Buffer.alloc(128, 0x89));
    assert.equal(await assertImageLanded(ok), 128);
  });

  it("API tiny payload does not claim API edit saved", async () => {
    const prev = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = "test-key";
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      async json() {
        return { data: [{ b64_json: Buffer.from("tiny").toString("base64") }] };
      },
    });
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-editimg-"));
      fs.writeFileSync(path.join(dir, "src.png"), Buffer.alloc(200, 0x89));
      const tool = createEditImageTool({ workingDir: dir, cfg: {} });
      const out = await tool.execute({ path: "src.png", prompt: "blur it" });
      const text = out.content?.[0]?.text || "";
      assert.doesNotMatch(text, /API edit saved/);
      assert.equal(out.isError, true);
      assert.match(text, /no image payload|too small/i);
    } finally {
      globalThis.fetch = orig;
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
    }
  });
});

describe("edit_image API HTML", () => {
  it("HTTP 200 invalid JSON is isError, not Magick success", async () => {
    const prev = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = "test-key";
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-editimg-html-"));
      fs.writeFileSync(path.join(dir, "src.png"), Buffer.alloc(200, 0x89));
      const tool = createEditImageTool({
        workingDir: dir,
        cfg: {},
        fetchFn: async () => ({
          ok: true,
          status: 200,
          async json() {
            throw new Error("Unexpected token <");
          },
        }),
      });
      const out = await tool.execute({ path: "src.png", prompt: "blur it" });
      assert.equal(out.isError, true);
      assert.match(out.content[0].text, /no image payload/i);
      assert.doesNotMatch(out.content[0].text, /Unexpected token|API edit saved|engine: imagemagick/);
    } finally {
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
    }
  });
});
