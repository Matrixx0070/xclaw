import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBrowserScreenshotTool } from "../src/tools/browser-tools.mjs";

function pngBuf(n = 128) {
  return Buffer.alloc(n, 0x89);
}

function toolFor(dir, callTool) {
  return createBrowserScreenshotTool({
    computer: { callTool },
    sessionId: "sess-1",
    workingDir: dir,
  });
}

describe("browser_screenshot does not claim success without an image file", () => {
  it("no image bytes is isError, not a successful screenshot", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-shot-"));
    const tool = toolFor(dir, async () => ({
      content: [{ type: "text", text: "tab opened, no png" }],
    }));
    const out = await tool.execute({});
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /no image bytes/i);
    assert.doesNotMatch(out.content[0].text, /^Screenshot saved:/);
  });

  it("tiny image payload is isError", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-shot-tiny-"));
    const tool = toolFor(dir, async () => ({
      content: [{ type: "image", data: Buffer.from("tiny").toString("base64") }],
    }));
    const out = await tool.execute({});
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /no image bytes/i);
  });

  it("metadata screenshotPath without a file is isError", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-shot-meta-"));
    const tool = toolFor(dir, async () => ({
      content: [],
      metadata: { screenshotPath: path.join(dir, "missing.png") },
    }));
    const out = await tool.execute({});
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /no image bytes/i);
  });

  it("real image bytes is success and the file re-reads", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-shot-ok-"));
    const payload = pngBuf(128);
    const tool = toolFor(dir, async () => ({
      content: [{ type: "image", data: payload.toString("base64") }],
    }));
    const out = await tool.execute({});
    assert.ok(!out.isError, JSON.stringify(out).slice(0, 200));
    assert.match(out.content[0].text, /Screenshot saved:/);
    const dest = out.content[0].text.replace(/^Screenshot saved:\s*/, "").trim();
    assert.equal(fs.statSync(dest).size, 128);
  });

  it("metadata screenshotPath succeeds only when the file exists and is large enough", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-shot-path-"));
    const shot = path.join(dir, "real.png");
    fs.writeFileSync(shot, pngBuf(128));
    const tool = toolFor(dir, async () => ({
      content: [],
      metadata: { screenshotPath: shot },
    }));
    const out = await tool.execute({});
    assert.ok(!out.isError, JSON.stringify(out).slice(0, 200));
    assert.match(out.content[0].text, /Screenshot saved:/);
    assert.match(out.content[0].text, /real\.png/);
  });
});
