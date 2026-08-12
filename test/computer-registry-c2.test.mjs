import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  listMaintainedTools,
  executeMaintainedTool,
  MAINTAINED_TOOLS,
  BUNDLE_ONLY_REGIONS,
} from "../src/computer/modules/registry.mjs";
import { listNativeTools, executeNativeTool } from "../src/computer/native-tools.mjs";

describe("Strategy C2 registry", () => {
  it("lists maintained tools including bash and files", () => {
    const names = listMaintainedTools().map((t) => t.name);
    assert.ok(names.includes("xclaw_bash"));
    assert.ok(names.some((n) => /file_read|read/i.test(n) || n.includes("file")));
    assert.ok(MAINTAINED_TOOLS.length >= 4);
  });

  it("execute bash via registry", async () => {
    const r = await executeMaintainedTool(
      "xclaw_bash",
      { command: "echo c2-ok" },
      { cwd: process.cwd() }
    );
    assert.ok(r.ok !== false);
    const out = String(r.stdout || r.data?.stdout || "");
    assert.match(out, /c2-ok/);
  });

  it("execute file write+read via registry", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-c2-"));
    const rel = "c2.txt";
    await executeMaintainedTool(
      "xclaw_file_write",
      { path: rel, content: "strategy-c2" },
      { cwd: dir }
    );
    const read = await executeMaintainedTool(
      "xclaw_file_read",
      { path: rel },
      { cwd: dir }
    );
    const body = String(read.content || read.data?.content || "");
    assert.match(body, /strategy-c2/);
  });

  it("native-tools delegates to registry", () => {
    assert.equal(listNativeTools().length, listMaintainedTools().length);
  });

  it("documents bundle-only regions", () => {
    assert.ok(BUNDLE_ONLY_REGIONS.includes("BrowserService"));
  });
});
