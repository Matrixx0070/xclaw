import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGlobTool, createGrepTool } from "../src/tools/extra-tools.mjs";

describe("glob/grep missing path is an error", () => {
  it("glob on a missing directory is isError", async () => {
    const tool = createGlobTool({ workingDir: os.tmpdir() });
    const out = await tool.execute({
      pattern: "*.mjs",
      path: path.join(os.tmpdir(), "xclaw-no-such-glob-dir"),
    });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /path not found/);
  });

  it("grep on a missing path is isError, not no matches", async () => {
    const tool = createGrepTool({ workingDir: os.tmpdir() });
    const out = await tool.execute({
      pattern: "foo",
      path: path.join(os.tmpdir(), "xclaw-no-such-grep-file.txt"),
    });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /path not found/);
  });

  it("grep source treats engine failure as isError, not no matches", () => {
    const src = fs.readFileSync(new URL("../src/tools/extra-tools.mjs", import.meta.url), "utf8");
    assert.match(src, /grep failed \(rg/);
  });
});
