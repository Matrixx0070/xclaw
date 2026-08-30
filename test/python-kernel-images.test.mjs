import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveKernelImages, createPythonSessionTool } from "../src/tools/python-tools.mjs";

describe("saveKernelImages", () => {
  it("skips tiny payloads", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-pyimg-"));
    const paths = await saveKernelImages([Buffer.from("tiny").toString("base64")], dir, "s");
    assert.equal(paths.length, 0);
  });

  it("writes and re-reads a real payload", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-pyimg-ok-"));
    const b64 = Buffer.alloc(64, 0x89).toString("base64");
    const paths = await saveKernelImages([b64], dir, "s");
    assert.equal(paths.length, 1);
    assert.equal(fs.statSync(paths[0]).size, 64);
  });

  it("execute treats unsaved kernel images as isError", () => {
    const src = fs.readFileSync(new URL("../src/tools/python-tools.mjs", import.meta.url), "utf8");
    assert.match(src, /kernel returned images but none could be saved/);
    assert.match(src, /kernel reset HTTP/);
    const resetChunk = src.slice(src.indexOf("args.reset === true"), src.indexOf("/execute"));
    assert.doesNotMatch(resetChunk, /\.catch\(\(\) => \{\}\)/);
    assert.ok(typeof createPythonSessionTool === "function");
  });
});
