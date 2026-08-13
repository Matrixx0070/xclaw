import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isImagePath } from "../src/channels/telegram/photo-out.mjs";

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
});
