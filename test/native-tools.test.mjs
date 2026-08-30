import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runBash } from "../src/computer/modules/bash-tool.mjs";
import {
  fileRead,
  fileWrite,
  fileEdit,
} from "../src/computer/modules/file-tools.mjs";
import { listNativeTools, executeNativeTool } from "../src/computer/native-tools.mjs";

describe("native computer tools", () => {
  it("lists bash and file tools", () => {
    const names = listNativeTools().map((t) => t.name);
    assert.ok(names.includes("xclaw_bash"));
    assert.ok(names.includes("xclaw_file_read"));
    assert.ok(names.includes("xclaw_file_write"));
    assert.ok(names.includes("xclaw_file_edit"));
    assert.ok(names.includes("xclaw_browser_tab"));
  });

  it("runBash echoes", async () => {
    const r = await runBash({ command: "echo native_p0_ok", timeout: 10 });
    assert.match(r.stdout, /native_p0_ok/);
    assert.equal(r.ok, true);
  });

  it("file write read edit in temp workspace", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-nt-"));
    const w = await fileWrite({ path: "a.txt", content: "hello" }, { cwd: dir });
    assert.equal(w.ok, true);
    assert.equal(w.bytes, Buffer.byteLength("hello"));
    const rd = await fileRead({ path: "a.txt" }, { cwd: dir });
    assert.match(rd.content, /hello/);
    await fileEdit(
      { path: "a.txt", old_string: "hello", new_string: "world" },
      { cwd: dir }
    );
    const rd2 = await fileRead({ path: "a.txt" }, { cwd: dir });
    assert.match(rd2.content, /world/);
  });

  it("executeNativeTool dispatches", async () => {
    const r = await executeNativeTool("xclaw_bash", {
      command: "echo dispatch_ok",
      timeout: 10,
    });
    assert.match(r.stdout || "", /dispatch_ok/);
  });
});
