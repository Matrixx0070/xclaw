import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createViewXVideoTool, looksLikeJpegBytes, videoFrameLanded } from "../src/tools/video-tools.mjs";

describe("view_x_video", () => {
  it("missing file is isError", async () => {
    const tool = createViewXVideoTool({ workingDir: os.tmpdir() });
    const out = await tool.execute({ path: "no-such-video.mp4" });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /not found/);
  });

  it("non-video file does not claim frames were extracted", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-vid-"));
    const p = path.join(dir, "not-a-video.bin");
    fs.writeFileSync(p, Buffer.alloc(64, 1));
    const tool = createViewXVideoTool({ workingDir: dir });
    const out = await tool.execute({ path: p, frames: 2, subtitles: false, ocr: false });
    assert.equal(out.isError, true);
    const text = out.content[0].text;
    assert.ok(
      /ffprobe failed|extracted 0\//.test(text),
      text.slice(0, 300)
    );
  });

  it("looksLikeJpegBytes rejects tiny, HTML, and non-JPEG", () => {
    assert.equal(looksLikeJpegBytes(Buffer.from("x")), false);
    assert.equal(looksLikeJpegBytes(Buffer.from("<html>" + "x".repeat(120))), false);
    assert.equal(looksLikeJpegBytes(Buffer.alloc(128, 0x89)), false);
    assert.equal(looksLikeJpegBytes(Buffer.from([0xff, 0xd8, ...Buffer.alloc(120, 0x00)])), true);
  });

  it("videoFrameLanded does not treat a leftover HTML dest as a frame", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-frame-"));
    const dest = path.join(dir, "frame_00.jpg");
    fs.writeFileSync(dest, "<html>" + "x".repeat(120));
    assert.equal(await videoFrameLanded(dest), null);
    fs.writeFileSync(dest, Buffer.from([0xff, 0xd8, ...Buffer.alloc(120, 0x11)]));
    assert.equal(await videoFrameLanded(dest), dest);
  });

  it("source fail-closes ffprobe non-zero instead of probing duration from error JSON", () => {
    const src = fs.readFileSync(new URL("../src/tools/video-tools.mjs", import.meta.url), "utf8");
    assert.match(src, /videoFrameLanded/);
    assert.match(src, /if \(probe\.code !== 0\)/);
    assert.doesNotMatch(src, /probe\.code !== 0 && !duration/);
  });
});
