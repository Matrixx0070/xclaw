#!/usr/bin/env node
/**
 * Ledger guard — enforce that docs/GROK-PROGRESS.md is append-only.
 *
 * Fails (exit 1) when, compared to a base commit, the ledger has shrunk in
 * bytes OR any existing line was deleted/rewritten (numstat deletions > 0).
 * Editing a line counts as delete+add and fails — that's the point: entries
 * are never overwritten, only appended.
 *
 * Usage: node scripts/ledger-guard.mjs <base-commit> [file]
 * Exit codes: 0 ok/skip (no base, file new at base), 1 violation, 2 usage.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const base = process.argv[2];
const file = process.argv[3] || "docs/GROK-PROGRESS.md";

function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", ...opts });
}

function fail(msg) {
  console.error(`[ledger-guard] FAIL: ${msg}`);
  console.error(
    `[ledger-guard] ${file} is append-only — new entries go at the bottom; never delete or rewrite earlier entries.`
  );
  process.exit(1);
}

if (!base) {
  console.error("[ledger-guard] usage: node scripts/ledger-guard.mjs <base-commit> [file]");
  process.exit(2);
}

// Base commit must exist (shallow clones / new branches: treat as skip)
try {
  git(["cat-file", "-e", `${base}^{commit}`]);
} catch {
  console.log(`[ledger-guard] base ${base} not found — skipping (nothing to compare)`);
  process.exit(0);
}

// File may be new at base — nothing to protect yet
let oldContent;
try {
  oldContent = git(["show", `${base}:${file}`]);
} catch {
  console.log(`[ledger-guard] ${file} absent at base — ok (new ledger)`);
  process.exit(0);
}

if (!fs.existsSync(file)) {
  fail(`${file} was deleted`);
}
const newContent = fs.readFileSync(file, "utf8");

const oldBytes = Buffer.byteLength(oldContent, "utf8");
const newBytes = Buffer.byteLength(newContent, "utf8");
console.log(`[ledger-guard] ${file}: base=${oldBytes}B head=${newBytes}B`);

if (newBytes < oldBytes) {
  fail(`ledger shrank ${oldBytes} -> ${newBytes} bytes`);
}

// numstat deletions against the working tree (covers rewrites, not just shrink)
const numstat = git(["diff", "--numstat", base, "--", file]).trim();
if (numstat) {
  const [added, deleted] = numstat.split(/\s+/).map(Number);
  console.log(`[ledger-guard] lines: +${added} -${deleted}`);
  if (deleted > 0) {
    const removed = git(["diff", base, "--", file])
      .split("\n")
      .filter((l) => l.startsWith("-") && !l.startsWith("---"))
      .slice(0, 10);
    console.error(removed.map((l) => `  ${l}`).join("\n"));
    fail(`${deleted} line(s) deleted or rewritten`);
  }
}

console.log("[ledger-guard] OK — append-only");
