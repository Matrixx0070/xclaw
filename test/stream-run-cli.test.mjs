import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRunArgs, runHelp } from "../src/cli/stream-run.mjs";

describe("parseRunArgs", () => {
  it("parses message and defaults", () => {
    const o = parseRunArgs(["hello", "world"]);
    assert.equal(o.message, "hello world");
    assert.equal(o.ndjson, true);
    assert.equal(o.kind, "agent");
  });

  it("parses resume flags", () => {
    const o = parseRunArgs([
      "--resume",
      "agent_abc",
      "--last-event-id",
      "agent_abc:3",
    ]);
    assert.equal(o.streamId, "agent_abc");
    assert.equal(o.lastEventId, "agent_abc:3");
    assert.equal(o.resume, true);
  });

  it("parses swarm goal", () => {
    const o = parseRunArgs(["--swarm", "--goal", "ship it"]);
    assert.equal(o.kind, "swarm");
    assert.equal(o.goal, "ship it");
  });

  it("help text mentions resume", () => {
    assert.match(runHelp(), /--resume/);
    assert.match(runHelp(), /--ndjson/);
  });

  it("parses backoff strategy flags", () => {
    const o = parseRunArgs([
      "--backoff",
      "decorrelated",
      "--base-ms",
      "500",
      "--max-ms",
      "8000",
      "hi",
    ]);
    assert.equal(o.backoff, "decorrelated");
    assert.equal(o.baseMs, 500);
    assert.equal(o.maxMs, 8000);
    assert.equal(o.message, "hi");
  });
});

import {
  exitCodeForResumeError,
  resumeFailureHints,
  formatResumeFailure,
} from "../src/cli/stream-run.mjs";
import { ResumeError } from "../src/client/stream-resume-client.mjs";

describe("resume failure handling", () => {
  it("maps codes to exit codes", () => {
    assert.equal(
      exitCodeForResumeError(new ResumeError("x", { code: "STREAM_NOT_FOUND" })),
      2
    );
    assert.equal(
      exitCodeForResumeError(new ResumeError("x", { code: "AUTH" })),
      3
    );
    assert.equal(
      exitCodeForResumeError(new ResumeError("x", { code: "MAX_RESUME_CYCLES" })),
      6
    );
    assert.equal(
      exitCodeForResumeError(new ResumeError("x", { code: "ABORTED" })),
      130
    );
  });

  it("hints for STREAM_NOT_FOUND", () => {
    const hints = resumeFailureHints(
      new ResumeError("gone", { code: "STREAM_NOT_FOUND" })
    );
    assert.ok(hints.some((h) => /new run|omit --resume/i.test(h)));
  });

  it("formatResumeFailure is machine-readable", () => {
    const p = formatResumeFailure(
      new ResumeError("Unknown streamId", {
        code: "STREAM_NOT_FOUND",
        streamId: "agent_x",
        retryable: false,
      }),
      { kind: "agent" }
    );
    assert.equal(p.ok, false);
    assert.equal(p.code, "STREAM_NOT_FOUND");
    assert.equal(p.exitCode, 2);
    assert.equal(p.streamId, "agent_x");
    assert.ok(p.hints.length >= 1);
  });
});
