import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isImagePath, sendPhotoFile } from "../src/channels/telegram/photo-out.mjs";
import { sendTelegramVoiceNote } from "../src/channels/telegram/voice-out.mjs";

describe("telegram image delivery", () => {
  it("isImagePath recognizes image files only", () => {
    for (const p of ["a/b/gen_1.png", "x.JPG", "y.jpeg", "z.webp", "w.gif"]) assert.equal(isImagePath(p), true, p);
    for (const p of ["a.txt", "a.mp3", "a.pdf", "", null, 5]) assert.equal(isImagePath(p), false, String(p));
  });
  it("base extracts image artifacts + runtime/telegram wire them through", async () => {
    const fs = await import("node:fs/promises");
    const base = await fs.readFile(new URL("../src/channels/base.mjs", import.meta.url), "utf8");
    assert.match(base, /images: extractImageArtifacts\(result\.toolTrace\)/);
    const rt = await fs.readFile(new URL("../src/channels/runtime.mjs", import.meta.url), "utf8");
    assert.match(rt, /images: result\.images/);
    const tg = await fs.readFile(new URL("../src/channels/telegram/index.mjs", import.meta.url), "utf8");
    assert.match(tg, /sendPhotoFile/);
    assert.match(tg, /out\.images/);
  });

  it("sendPhotoFile HTTP 200 HTML is invalid JSON, not a document retry", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-tg-photo-"));
    const p = path.join(dir, "x.png");
    fs.writeFileSync(p, Buffer.alloc(128, 1));
    const orig = globalThis.fetch;
    let n = 0;
    globalThis.fetch = async () => {
      n += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          throw new Error("Unexpected token <");
        },
      };
    };
    try {
      const out = await sendPhotoFile({ token: "T", chatId: 1, filePath: p });
      assert.equal(out.ok, false);
      assert.match(out.error, /invalid JSON/);
      assert.doesNotMatch(out.error, /Unexpected token/);
      assert.equal(n, 1, "must not retry HTML as sendDocument");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("sendTelegramVoiceNote HTTP 200 HTML is invalid JSON, not Unexpected token", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-tg-voice-"));
    const p = path.join(dir, "v.ogg");
    fs.writeFileSync(p, Buffer.alloc(128, 2));
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      async json() {
        throw new Error("Unexpected token <");
      },
    });
    try {
      await assert.rejects(
        () => sendTelegramVoiceNote({ token: "T", chatId: 1, filePath: p, format: "ogg" }),
        (err) => /invalid JSON/.test(String(err?.message || err)) && !/Unexpected token/.test(String(err?.message || err))
      );
    } finally {
      globalThis.fetch = orig;
    }
  });
});
