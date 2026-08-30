import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createFileTypeTool,
  createMarkitdownTool,
  markitdownPickResult,
} from "../src/tools/host-utils.mjs";

describe("file_type", () => {
  it("missing path is isError", async () => {
    const tool = createFileTypeTool();
    const out = await tool.execute({ path: path.join(os.tmpdir(), "xclaw-no-such-file-type.bin") });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /not found/);
  });

  it("source treats dual-engine failure as isError", async () => {
    const src = fs.readFileSync(new URL("../src/tools/host-utils.mjs", import.meta.url), "utf8");
    assert.match(src, /file_type failed \(magika/);
    assert.doesNotMatch(src, /f\.stdout\.trim\(\) \|\| f\.stderr/);
    assert.match(src, /markitdownPickResult/);
  });
});

describe("markitdown does not claim success on a failed convert", () => {
  it("missing path is isError", async () => {
    const tool = createMarkitdownTool();
    const out = await tool.execute({ path: path.join(os.tmpdir(), "xclaw-no-such-md.bin") });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /not found/);
  });

  it("non-zero exit with traceback stdout is not success", () => {
    const r = markitdownPickResult(
      { code: 1, stdout: "Traceback (most recent call last):\n  boom\n", stderr: "" },
      { code: 1, stdout: "Usage: markitdown PATH\n", stderr: "command failed" }
    );
    assert.equal(r.ok, false);
    assert.match(r.error, /command failed|Traceback|exited/);
  });

  it("whitespace-only stdout is not markdown", () => {
    const r = markitdownPickResult(
      { code: 0, stdout: "  \n", stderr: "" },
      { code: 2, stdout: "", stderr: "fail" }
    );
    assert.equal(r.ok, false);
  });

  it("zero-exit markdown is success", () => {
    const r = markitdownPickResult(
      { code: 1, stdout: "", stderr: "no module" },
      { code: 0, stdout: "# Title\n\nbody\n" }
    );
    assert.equal(r.ok, true);
    assert.match(r.text, /# Title/);
  });
});
