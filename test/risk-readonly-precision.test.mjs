import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import { isReadOnlyExecCommand } from "../src/security/risk.mjs";

// Precision fixes derived from Frank's real blocked commands (2026-08-14
// live session): 2>&1 and /dev/null sinks are harmless; pm2 logs --nostream
// is a bounded read.
describe("read-only exec precision (live-derived)", () => {
  it("harmless stream redirects do not disqualify", () => {
    for (const cmd of [
      "pm2 describe sudo-ai-v5 2>&1 | head -50", // the exact live pend
      "pm2 logs sudo-ai-v5 --err --lines 50 --nostream 2>&1 | tail -100",
      "ls -la /root/sudo-ai-v4/data/logs/ 2>&1",
      "cat x 2>/dev/null",
      "grep foo bar >/dev/null",
      "cat x </dev/null",
    ]) {
      assert.equal(isReadOnlyExecCommand(cmd), true, cmd);
    }
  });

  it("classifier v2: the 12:24 approval-storm patterns classify (quote-aware scanner)", () => {
    for (const cmd of [
      'cd /root/proj && echo "--- ARCHITECTURE.md ---" && cat ARCHITECTURE.md',
      'cd /x && grep -rEo "TODO|FIXME|HACK" src --include="*.ts" | wc -l',
      "sed -n '1,120p' ecosystem.config.cjs",
      "cd /x && sed -n '14,45p' ARCHITECTURE.md",
      "awk 'NR>=6 && NR<=30' /tmp/report.txt",
      "awk '{print $1}' f",
      'grep "a>b" f', // > inside double quotes is inert in bash
      "cat 'weird; name'", // quoted separator is a filename, not a chain
    ]) {
      assert.equal(isReadOnlyExecCommand(cmd), true, cmd);
    }
  });

  it("classifier v2: quoted-content escapes still fail closed", () => {
    for (const cmd of [
      "awk '{print > \"f\"}' x", // awk output redirect
      "awk 'BEGIN{system(\"id\")}' x", // awk shell escape
      "sed -i 's/a/b/' f", // in-place write
      "sed -n '1,10p; s/x/y/e' f", // sed e executes
      "cd /x && npx anything", // npx runs arbitrary code
      'echo "$(id)"', // $() active inside double quotes
      'echo "`id`"', // backtick active inside double quotes
      'cat "unterminated', // unbalanced quote
      "cd /x; rm y", // chain with mutator
    ]) {
      assert.equal(isReadOnlyExecCommand(cmd), false, cmd);
    }
  });

  it("bare --version probes are read-only regardless of head (live mission stall)", () => {
    for (const cmd of ["node --version", "python3 --version", "cargo --version"]) {
      assert.equal(isReadOnlyExecCommand(cmd), true, cmd);
    }
    for (const cmd of ["node --version extra", "node -e 'x' --version", "node -v", "--version"]) {
      assert.equal(isReadOnlyExecCommand(cmd), false, cmd);
    }
  });

  it("real redirects and bypass shapes still fail closed", () => {
    for (const cmd of [
      "pm2 logs sudo-ai-v5", // unbounded tail
      "cat x 2>/dev/nullX", // fake /dev/null — writes a real file
      "cat x > out.txt 2>&1",
      "echo hi >&file", // both-streams-to-file form
      "cat x 2>&1; rm y",
      "cat x >> /dev/null.evil",
    ]) {
      assert.equal(isReadOnlyExecCommand(cmd), false, cmd);
    }
  });
});

// Wiring tripwires for the duplicate-approval-prompt fix (loop re-emits
// approval_required as a timeout state update; telegram must not re-prompt —
// live-observed identical prompts exactly 120s apart).
describe("approval prompt dedupe wiring", () => {
  it("loop marks the timeout re-emission", async () => {
    const src = await fs.readFile(new URL("../src/agent/loop.mjs", import.meta.url), "utf8");
    assert.match(src, /timedOut: auth\.reason === "timeout"/);
  });
  it("telegram skips timedOut updates and dedupes by pendingId", async () => {
    const src = await fs.readFile(new URL("../src/channels/telegram/index.mjs", import.meta.url), "utf8");
    assert.match(src, /if \(!e\.timedOut\)/);
    assert.match(src, /promptedApprovals\.has\(item\.id\)/);
    // latch only after a successful send — failed sends stay re-promptable
    const latchIdx = src.indexOf("promptedApprovals.add(item.id)");
    const logIdx = src.indexOf("approval prompt ${item.id}");
    assert.ok(latchIdx > logIdx && logIdx > 0, "latch must follow successful delivery");
  });
});
