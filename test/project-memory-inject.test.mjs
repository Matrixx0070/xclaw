import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadMemoryFiles,
  buildContextSections,
  previewProjectMemory,
} from "../src/skills/loader.mjs";

describe("XCLAW.md auto-injection", () => {
  it("loads XCLAW.md from workspace root", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-mem-"));
    fs.writeFileSync(
      path.join(dir, "XCLAW.md"),
      "# Test project\n\n- always use ESM\n- do not commit secrets\n"
    );
    const files = await loadMemoryFiles(dir);
    assert.ok(files.some((f) => f.name === "XCLAW.md"));
    const body = files.find((f) => f.name === "XCLAW.md").body;
    assert.match(body, /always use ESM/);
  });

  it("buildContextSections marks auto-injected project memory", async () => {
    const sections = buildContextSections({
      memoryFiles: [
        {
          path: "/tmp/demo/XCLAW.md",
          name: "XCLAW.md",
          body: "Use xclaw_* tools only.",
        },
      ],
    });
    assert.match(sections, /Project memory \(auto-injected\)/);
    assert.match(sections, /xclaw_\*/);
    assert.match(sections, /authoritative/);
  });

  it("previewProjectMemory returns files + sections", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-mem2-"));
    fs.writeFileSync(path.join(dir, "XCLAW.md"), "## Commands\n- test: npm test\n");
    const prev = await previewProjectMemory(dir);
    assert.equal(prev.files.length, 1);
    assert.ok(prev.chars > 0);
    assert.match(prev.sections, /npm test/);
  });

  it("nearest XCLAW.md wins attention order (last in list)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-mem3-"));
    // The upward walk stops at the workspace git root (trust boundary) —
    // mark the fixture root as that boundary so both levels are in scope.
    fs.mkdirSync(path.join(root, ".git"));
    const sub = path.join(root, "pkg");
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(root, "XCLAW.md"), "ROOT rules");
    fs.writeFileSync(path.join(sub, "XCLAW.md"), "NESTED rules");
    const files = await loadMemoryFiles(sub);
    assert.ok(files.length >= 2);
    assert.match(files[files.length - 1].body, /NESTED/);
  });
});
