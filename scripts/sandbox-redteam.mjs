#!/usr/bin/env node
/**
 * Deterministic sandbox red team (no model required).
 */
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import {
  guardToolPaths,
  resolveSandboxPath,
  getSandboxPolicy,
} from "../src/security/sandbox.mjs";

const ws = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-rt-"));
await fs.writeFile(path.join(ws, "keep.txt"), "ok");

const cfg = { sandbox: { enabled: true, readOnly: false } };
const policy = getSandboxPolicy(cfg, ws);

const results = [];

function check(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
  }
}

// escape must throw
check("deny_dotdot", () => {
  try {
    resolveSandboxPath(policy, "../outside.txt");
    throw new Error("should have thrown");
  } catch (e) {
    if (e.message.includes("should have thrown")) throw e;
    if (!/escape/i.test(e.message)) throw e;
  }
});

check("deny_tool_write_escape", () => {
  const r = guardToolPaths(cfg, ws, "file_write", { path: "../../etc/passwd" });
  if (r.ok) throw new Error("escape allowed");
});

check("allow_in_workspace", () => {
  const r = guardToolPaths(cfg, ws, "file_write", { path: "out/blocked.txt" });
  if (!r.ok) throw new Error(r.error);
});

check("readonly_blocks_write", () => {
  const r = guardToolPaths(
    { sandbox: { enabled: true, readOnly: true } },
    ws,
    "file_write",
    { path: "x.txt" }
  );
  if (r.ok) throw new Error("readonly allowed write");
});

const failed = results.filter((r) => !r.pass);
console.log(JSON.stringify({ workspace: ws, results, ok: failed.length === 0 }, null, 2));
process.exit(failed.length ? 1 : 0);
