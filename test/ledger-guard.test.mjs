import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const guard = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../scripts/ledger-guard.mjs"
);

let repo;
let baseSha;
const LEDGER = "docs/GROK-PROGRESS.md";

function git(args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function runGuard(base) {
  try {
    const stdout = execFileSync(process.execPath, [guard, base], {
      cwd: repo,
      encoding: "utf8",
    });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ""}${err.stderr || ""}` };
  }
}

function writeLedger(content) {
  fs.writeFileSync(path.join(repo, LEDGER), content);
}

describe("ledger-guard append-only enforcement", () => {
  before(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ledger-guard-"));
    git(["init", "-q"]);
    git(["config", "user.email", "t@t"]);
    git(["config", "user.name", "t"]);
    fs.mkdirSync(path.join(repo, "docs"));
    writeLedger("# GROK-PROGRESS\n\n## entry one\nSTATUS: green\n");
    git(["add", "."]);
    git(["commit", "-qm", "base"]);
    baseSha = git(["rev-parse", "HEAD"]).trim();
  });

  after(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("append passes", () => {
    writeLedger("# GROK-PROGRESS\n\n## entry one\nSTATUS: green\n\n## entry two\nSTATUS: green\n");
    const r = runGuard(baseSha);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /OK — append-only/);
  });

  it("unchanged passes", () => {
    writeLedger("# GROK-PROGRESS\n\n## entry one\nSTATUS: green\n");
    assert.equal(runGuard(baseSha).code, 0);
  });

  it("shrink fails", () => {
    writeLedger("# GROK-PROGRESS\n");
    const r = runGuard(baseSha);
    assert.equal(r.code, 1);
    assert.match(r.out, /shrank/);
  });

  it("rewrite of an existing line fails even when the file grows", () => {
    writeLedger(
      "# GROK-PROGRESS\n\n## entry one\nSTATUS: REWRITTEN to something much longer than before\n\n## entry two\nmore\n"
    );
    const r = runGuard(baseSha);
    assert.equal(r.code, 1);
    assert.match(r.out, /deleted or rewritten/);
  });

  it("file deletion fails", () => {
    fs.rmSync(path.join(repo, LEDGER));
    const r = runGuard(baseSha);
    assert.equal(r.code, 1);
    assert.match(r.out, /deleted/);
    // restore for any later assertions
    writeLedger("# GROK-PROGRESS\n\n## entry one\nSTATUS: green\n");
  });

  it("missing base skips (exit 0)", () => {
    const r = runGuard("0000000000000000000000000000000000000000");
    assert.equal(r.code, 0);
    assert.match(r.out, /skipping/);
  });

  it("file absent at base skips (exit 0)", () => {
    const first = execFileSync(
      process.execPath,
      [guard, baseSha, "docs/DOES-NOT-EXIST-AT-BASE.md"],
      { cwd: repo, encoding: "utf8" }
    );
    assert.match(first, /absent at base — ok/);
  });
});
