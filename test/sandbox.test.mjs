import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  getSandboxPolicy,
  resolveSandboxPath,
  guardToolPaths,
} from "../src/security/sandbox.mjs";

describe("sandbox", () => {
  const ws = "/tmp/xclaw-sb-ws";
  it("allows relative under workspace", () => {
    const p = getSandboxPolicy({ sandbox: { enabled: true } }, ws);
    const abs = resolveSandboxPath(p, "foo/bar.txt");
    assert.ok(abs.startsWith(path.resolve(ws)));
  });
  it("denies escape", () => {
    const p = getSandboxPolicy({ sandbox: { enabled: true } }, ws);
    assert.throws(() => resolveSandboxPath(p, "../etc/passwd"));
  });
  it("guards tool args", () => {
    const r = guardToolPaths({ sandbox: { enabled: true } }, ws, "file_read", {
      path: "a.txt",
    });
    assert.equal(r.ok, true);
    const bad = guardToolPaths({ sandbox: { enabled: true } }, ws, "file_read", {
      path: "../../secret",
    });
    assert.equal(bad.ok, false);
  });
});
