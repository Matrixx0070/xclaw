import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createViewXVideoTool } from "../src/tools/video-tools.mjs";

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
});
