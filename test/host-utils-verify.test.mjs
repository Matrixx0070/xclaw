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
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/tools/host-utils.mjs", import.meta.url), "utf8");
    assert.match(src, /file_type failed \(magika/);
    assert.match(src, /markitdown failed for \$\{p\} \(exit/);
  });
});
