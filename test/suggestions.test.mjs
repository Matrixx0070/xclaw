import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTurnSuggestions,
  summarizeToolTrace,
  detectTurnClosure,
  extractGrounding,
} from "../src/agent/suggestions.mjs";

describe("summarizeToolTrace", () => {
  it("reads schema fields", () => {
    const s = summarizeToolTrace([
      {
        name: "xclaw_file_write",
        status: "ok",
        outcome: { kind: "success", summary: "wrote", confidence: 1 },
        artifacts: [{ type: "file", ref: "src/a.mjs", role: "output" }],
      },
      {
        name: "xclaw_bash",
        status: "fail",
        outcome: { kind: "test_fail", summary: "3 failed", exitCode: 1, confidence: 0.9 },
        artifacts: [{ type: "command", ref: "npm test", role: "input" }],
      },
    ]);
    assert.equal(s.failed.length, 1);
    assert.ok(s.okWrites.includes("src/a.mjs"));
    assert.equal(s.allOk, false);
  });
});

describe("closure", () => {
  it("open on failure", () => {
    const c = detectTurnClosure({
      userMessage: "run tests",
      replyText: "Tests failed.",
      toolTrace: [
        {
          name: "xclaw_bash",
          status: "fail",
          outcome: { kind: "test_fail", summary: "3 failed", confidence: 0.9 },
        },
      ],
    });
    assert.equal(c.closed, false);
    assert.equal(c.reason, "failed");
  });

  it("closed on action + all ok + done language", () => {
    const c = detectTurnClosure({
      userMessage: "Implement chunk overflow",
      replyText: "Done. Implemented overflow and all tests pass.",
      toolTrace: [
        {
          name: "xclaw_file_write",
          status: "ok",
          outcome: { kind: "success", summary: "ok", confidence: 1 },
          artifacts: [{ type: "file", ref: "src/chunk-text.mjs", role: "output" }],
        },
      ],
    });
    assert.equal(c.closed, true);
    assert.ok(c.confidence >= 0.6);
  });

  it("suppresses chips when closed and clean", () => {
    const items = buildTurnSuggestions({
      userMessage: "Add chunk overflow",
      replyText: "Done. Implemented and tests pass.",
      toolTrace: [
        {
          name: "xclaw_file_write",
          status: "ok",
          artifacts: [{ type: "file", ref: "src/x.mjs", role: "output" }],
          outcome: { kind: "success", summary: "ok", confidence: 1 },
        },
      ],
      git: { isRepo: true, dirty: false, fileCount: 0 },
      cfg: {
        suggestions: {
          enabled: true,
          suppressOnClose: true,
          closureMinConfidence: 0.6,
          closedAllowCommitChip: "auto",
          skipGitInspect: true,
        },
      },
    });
    assert.equal(items.length, 0);
  });
});

describe("schema-native chips", () => {
  it("diagnoses test_fail from status", () => {
    const items = buildTurnSuggestions({
      userMessage: "run tests",
      replyText: "There were failures in the suite.",
      toolTrace: [
        {
          name: "xclaw_bash",
          status: "fail",
          outcome: {
            kind: "test_fail",
            summary: "3 failed",
            exitCode: 1,
            confidence: 0.9,
          },
          artifacts: [{ type: "command", ref: "npm test", role: "input" }],
        },
      ],
      cfg: { suggestions: { max: 3, minScore: 0.3 } },
    });
    assert.ok(items.length >= 1);
    assert.match(items[0].label + items[0].prompt, /fail|Fix|Diagnose/i);
    assert.equal(items[0].source, "trace_fail");
  });

  it("grounds review on ok write artifacts", () => {
    const items = buildTurnSuggestions({
      userMessage: "keep working on the helper",
      replyText: "Updated the helper; more work remains next.",
      toolTrace: [
        {
          name: "xclaw_file_write",
          status: "ok",
          outcome: { kind: "success", summary: "ok", confidence: 1 },
          artifacts: [
            {
              type: "file",
              ref: "src/channels/telegram/chunk-text.mjs",
              role: "output",
            },
          ],
        },
      ],
      cfg: { suggestions: { max: 3, minScore: 0.3, suppressOnClose: true } },
    });
    assert.ok(items.some((s) => /chunk-text|Review|Tests/i.test(s.label + s.prompt)));
  });
});

describe("legacy extractGrounding", () => {
  it("still works", () => {
    const g = extractGrounding([
      {
        name: "xclaw_bash",
        status: "fail",
        outcome: { kind: "command_fail" },
        blocked: false,
      },
    ]);
    assert.ok(g.errors.length);
  });
});
