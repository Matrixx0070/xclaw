import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGlobTool, createGrepTool, grepEngineOk } from "../src/tools/extra-tools.mjs";

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

  it("glob walk unreadable dirs is isError, not no matches", () => {
    const src = fs.readFileSync(new URL("../src/tools/extra-tools.mjs", import.meta.url), "utf8");
    assert.match(src, /glob could not read/);
  });

  it("grep source treats engine failure as isError, not no matches", () => {
    const src = fs.readFileSync(new URL("../src/tools/extra-tools.mjs", import.meta.url), "utf8");
    assert.match(src, /grep failed \(rg/);
    assert.match(src, /grepEngineOk/);
    assert.doesNotMatch(src, /rg\.code !== 0 && rg\.code !== 1 && !rg\.stdout/);
  });

  it("rg/grep exit 2 with stdout traceback is engine failure, not matches", () => {
    assert.equal(grepEngineOk({ code: 2, stdout: "rg: regex parse error\n" }), false);
    assert.equal(grepEngineOk({ code: 0, stdout: "a:1:hit" }), true);
    assert.equal(grepEngineOk({ code: 1, stdout: "" }), true);
    assert.equal(grepEngineOk({ code: 0, timedOut: true, stdout: "a:1:hit" }), false);
  });
});
