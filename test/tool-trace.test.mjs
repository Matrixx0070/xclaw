import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  beginToolTraceEntry,
  finalizeToolTraceEntry,
  inferOutcome,
  collectArtifacts,
  normalizeToolFamily,
  isBlockedEntry,
  isFailEntry,
  resetToolTraceSeq,
  parseShellExitCode,
  parseTestSummary,
  parseShellOutcome,
  parseWriteOutcome,
  parseReadOutcome,
  parseSwarmOutcome,
  extractStructuredResult,
} from "../src/agent/tool-trace.mjs";

describe("tool-trace", () => {
  it("normalizeToolFamily", () => {
    assert.equal(normalizeToolFamily("xclaw_bash"), "shell");
    assert.equal(normalizeToolFamily("xclaw_file_write"), "write");
  });

  it("infers blocked", () => {
    const o = inferOutcome({ blocked: true, policyDecision: "deny" });
    assert.equal(o.status, "blocked");
    assert.equal(o.outcome.kind, "permission");
  });

  it("infers test_fail from exit and text", () => {
    const o = inferOutcome({
      name: "xclaw_bash",
      resultText: "exit code: 1\n3 failed\n14 passed",
    });
    assert.equal(o.status, "fail");
    assert.equal(o.outcome.kind, "test_fail");
    assert.equal(o.outcome.exitCode, 1);
  });

  it("collects file and command artifacts", () => {
    const a = collectArtifacts(
      "xclaw_file_write",
      { path: "src/foo.mjs" },
      "ok"
    );
    assert.ok(a.some((x) => x.type === "file" && x.ref.includes("foo")));
  });

  it("finalize keeps legacy fields", () => {
    resetToolTraceSeq();
    const partial = beginToolTraceEntry({
      name: "xclaw_bash",
      args: { command: "echo hi" },
      toolCallId: "c1",
      turn: 1,
    });
    const e = finalizeToolTraceEntry(partial, {
      resultText: "hi\nexit code: 0",
      originalChars: 20,
      keptChars: 20,
    });
    assert.equal(e.status, "ok");
    assert.equal(typeof e.result, "string");
    assert.ok(e.resultView);
    assert.ok(e.artifacts.some((a) => a.type === "command"));
    assert.equal(e.blocked, false);
    assert.ok(e.id.startsWith("tt_"));
  });

  it("blocked entry helpers", () => {
    const partial = beginToolTraceEntry({ name: "bash", args: {} });
    const e = finalizeToolTraceEntry(partial, {
      resultText: "denied",
      blocked: true,
      policy: { phase: "sandbox", decision: "deny" },
    });
    assert.ok(isBlockedEntry(e));
    assert.equal(isFailEntry(e), false);
  });
});

describe("family parsers", () => {
  it("parseShellExitCode prefers last exit", () => {
    assert.equal(parseShellExitCode("exit code: 0\nstuff\nexit code: 2"), 2);
  });

  it("parseTestSummary", () => {
    const t = parseTestSummary("3 failed\n14 passed");
    assert.equal(t.failed, 3);
    assert.equal(t.passed, 14);
  });

  it("shell uses structured exitCode", () => {
    const o = parseShellOutcome({
      resultText: "blah",
      structured: { exitCode: 0 },
    });
    assert.equal(o.status, "ok");
    assert.equal(o.outcome.exitCode, 0);
  });

  it("write outcome includes path", () => {
    const o = parseWriteOutcome({
      args: { path: "src/a.mjs" },
      resultText: "ok",
    });
    assert.equal(o.status, "ok");
    assert.match(o.outcome.summary, /src\/a\.mjs/);
  });

  it("read not_found", () => {
    const o = parseReadOutcome({
      args: { path: "missing.txt" },
      resultText: "ENOENT: no such file",
    });
    assert.equal(o.status, "fail");
    assert.equal(o.outcome.kind, "not_found");
  });

  it("swarm conflict", () => {
    const o = parseSwarmOutcome({
      name: "xclaw_swarm_merge_approve",
      resultText: "merge conflict in worktree",
    });
    assert.equal(o.status, "fail");
    assert.equal(o.outcome.kind, "conflict");
  });

  it("extractStructuredResult from metadata", () => {
    const s = extractStructuredResult({
      metadata: { exitCode: 7 },
      content: [{ type: "text", text: "no" }],
    });
    assert.equal(s.exitCode, 7);
  });

  it("inferOutcome dispatches by family", () => {
    const shell = inferOutcome({
      name: "xclaw_bash",
      result: { metadata: { exitCode: 1 }, content: [{ type: "text", text: "2 failed" }] },
      resultText: "2 failed\nexit code: 1",
    });
    assert.equal(shell.outcome.kind, "test_fail");

    const write = inferOutcome({
      name: "xclaw_file_write",
      args: { path: "x.mjs" },
      resultText: "ok",
    });
    assert.equal(write.status, "ok");
    assert.match(write.outcome.summary, /x\.mjs/);
  });
});
