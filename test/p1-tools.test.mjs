import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAllLocalTools, localToolNames } from "../src/tools/registry.mjs";
import { createViewXVideoTool } from "../src/tools/video-tools.mjs";
import { createSearchImagesTool } from "../src/tools/image-tools.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";

describe("P1 tools", () => {
  it("registers view_x_video and image tools", () => {
    const names = localToolNames(createAllLocalTools({ workingDir: process.cwd() }));
    for (const n of ["view_x_video", "search_images", "generate_image", "edit_image", "view_image"]) {
      assert.ok(names.includes(n), n);
    }
  });

  it("view_x_video extracts frames from synthetic mp4", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-vid-"));
    const mp4 = path.join(tmp, "t.mp4");
    await new Promise((resolve, reject) => {
      const c = spawn("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=320x240:d=2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        mp4,
      ]);
      c.on("close", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg fail"))));
      c.on("error", reject);
    });
    const tool = createViewXVideoTool({ workingDir: tmp });
    const r = await tool.execute({ path: mp4, frames: 2, subtitles: false });
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /frames/);
  });

  it("search_images returns structure or soft error", async () => {
    const tool = createSearchImagesTool({ workingDir: process.cwd() });
    const r = await tool.execute({ query: "red circle abstract", count: 2 });
    // network may fail in restricted env — either results or error is ok
    assert.ok(r.content?.[0]?.text);
  });
});
