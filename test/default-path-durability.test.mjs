import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

describe("default-path durability wiring", () => {
  it("CLI job prints verdict and stopReason", () => {
    const src = read("bin/xclaw.mjs");
    const start = src.indexOf('case "job"');
    const end = src.indexOf('case "wait-ready"');
    assert.ok(start >= 0 && end > start);
    const jobCase = src.slice(start, end);
    assert.match(jobCase, /verdict: job\.verdict/);
    assert.match(jobCase, /stopReason: job\.stopReason/);
  });

  it("CLI runs list exits 1 when a snapshot is unfinished", () => {
    const src = read("bin/xclaw.mjs");
    const start = src.indexOf('case "runs"');
    const end = src.indexOf('case "approvals"');
    assert.ok(start >= 0 && end > start);
    assert.match(src.slice(start, end), /r\.resumable \|\| r\.ok === false/);
    assert.match(src.slice(start, end), /sub === "resume"/);
    assert.match(src.slice(start, end), /resumeAgentRunAsObjective/);
  });

  it("Control UI lists durable agent-runs", () => {
    const html = read("ui/control/index.html");
    const js = read("ui/control/app.js");
    assert.match(html, /id="agentRunsTable"/);
    assert.match(js, /loadAgentRuns/);
    assert.match(js, /\/agent-runs\?limit=/);
  });

  it("CLI agent goes through runAgent, persists, and auto-promotes on maxTurns", () => {
    const src = read("bin/xclaw.mjs");
    const start = src.indexOf('case "agent"');
    const end = src.indexOf('case "soak"');
    assert.ok(start >= 0 && end > start, "agent case not found");
    const agentCase = src.slice(start, end);
    assert.match(agentCase, /runAgent\(/);
    assert.doesNotMatch(agentCase, /\brunAgentLoop\s*\(/);
    assert.match(agentCase, /persistRun:\s*true/);
    assert.match(agentCase, /autoPromoteIfNeeded/);
    assert.match(agentCase, /awaitRun:\s*true/);
    assert.match(agentCase, /agentExitCode/);
  });

  it("webchat persists the session and auto-promotes a turn-cap cutoff", () => {
    const src = read("src/channels/webchat/index.mjs");
    assert.match(src, /persistRun:\s*true/);
    assert.match(src, /autoPromoteIfNeeded/);
    assert.match(src, /formatPromotedReply/);
    assert.match(src, /ok:\s*result\.ok !== false/);
  });

  it("gateway /agent/run and the stream persist when a session id is present", () => {
    const json = read("src/gateway/routes/agent-run.mjs");
    assert.match(json, /persistRun:\s*runSessionId \? true : undefined/);
    const stream = read("src/gateway/index.mjs");
    assert.match(stream, /persistRun:\s*streamSessionId \? true : undefined/);
    assert.match(stream, /stopReason:\s*result\.stopReason/);
    assert.match(stream, /ok:\s*result\.ok !== false/);
    assert.match(json, /ok:\s*result\.ok !== false/);
  });

  it("the loop persist key is resolved once, including chatSessionId", () => {
    const src = read("src/agent/loop.mjs");
    assert.match(src, /resolveRunPersistId/);
    assert.match(src, /persistSessionId/);
    assert.doesNotMatch(
      src,
      /if \(options\.sessionId \|\| options\.persistRun\)/
    );
  });

  it("gateway boot auto-resumes interrupted agent-runs through the objective orchestrator", () => {
    const src = read("src/gateway/index.mjs");
    assert.match(src, /reconcileAndResumeAgentRuns/);
    assert.match(src, /resumeObjectiveDetached/);
    assert.match(src, /agent-runs/);
  });

  it("processInbound surfaces ok:false as not complete in the channel reply", () => {
    const src = read("src/channels/runtime.mjs");
    assert.match(src, /Not complete \(\$\{why\}\)/);
    assert.match(src, /ok:\s*result\.ok !== false/);
  });

  it("the default loop runs the completion gate before treating a natural stop as done", () => {
    const src = read("src/agent/loop.mjs");
    assert.match(src, /evaluateNaturalStopVerify/);
    assert.match(src, /unverifiedStop/);
  });

  it("the default loop injects bounded durable-memory recall at start", () => {
    const src = read("src/agent/loop.mjs");
    assert.match(src, /recallMemory\(cfg, workingDir/);
    assert.match(src, /phase: "recall"/);
  });

  it("loop passes a session getter into local browser tools", () => {
    const src = read("src/agent/loop.mjs");
    assert.match(src, /sessionId: \(\) => sessionId/);
    const browser = read("src/tools/browser-tools.mjs");
    assert.match(browser, /callToolRecovering/);
    assert.match(browser, /tabCall/);
  });
});
