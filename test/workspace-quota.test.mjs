/**
 * Workspace disk + file-count quota preflight.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  resolveQuota,
  measureWorkspace,
  evaluateQuota,
  preflightWriteQuota,
  isWriteTool,
  estimateWriteDelta,
  DEFAULT_QUOTA,
} from "../src/security/workspace-quota.mjs";

describe("workspace quota", () => {
  let tmp;

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-quota-"));
    await fs.writeFile(path.join(tmp, "a.txt"), "hello");
    await fs.mkdir(path.join(tmp, "sub"));
    await fs.writeFile(path.join(tmp, "sub", "b.txt"), "world!!");
  });

  after(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("resolveQuota defaults", () => {
    const q = resolveQuota({});
    assert.equal(q.maxBytes, DEFAULT_QUOTA.maxBytes);
    assert.equal(q.enabled, true);
  });

  it("measureWorkspace counts files and bytes", async () => {
    const u = await measureWorkspace(tmp);
    assert.ok(u.files >= 2);
    assert.ok(u.bytes >= 5 + 7);
  });

  it("evaluateQuota hard on bytes", () => {
    const q = resolveQuota({ workspace: { quota: { maxBytes: 10, maxFiles: 1000 } } });
    const ev = evaluateQuota({ bytes: 20, files: 2 }, q);
    assert.equal(ev.ok, false);
    assert.equal(ev.hard, true);
  });

  it("preflightWriteQuota blocks over hard", async () => {
    const r = await preflightWriteQuota(
      tmp,
      { workspace: { quota: { maxBytes: 5, maxFiles: 100 } } },
      { extraBytes: 100 }
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "WORKSPACE_QUOTA_EXCEEDED");
  });

  it("preflight allows under quota", async () => {
    const r = await preflightWriteQuota(
      tmp,
      { workspace: { quota: { maxBytes: 10_000_000, maxFiles: 10_000 } } },
      { extraBytes: 10, extraFiles: 1 }
    );
    assert.equal(r.ok, true);
  });

  it("isWriteTool + estimateWriteDelta", () => {
    assert.equal(isWriteTool("xclaw_file_write"), true);
    assert.equal(isWriteTool("xclaw_file_read"), false);
    const d = estimateWriteDelta("xclaw_file_write", { content: "abcd" });
    assert.equal(d.extraBytes, 4);
    assert.equal(d.extraFiles, 1);
  });
});
