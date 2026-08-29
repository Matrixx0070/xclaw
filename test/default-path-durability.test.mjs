import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

describe("default-path durability wiring", () => {
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
  });

  it("webchat persists the session and auto-promotes a turn-cap cutoff", () => {
    const src = read("src/channels/webchat/index.mjs");
    assert.match(src, /persistRun:\s*true/);
    assert.match(src, /autoPromoteIfNeeded/);
    assert.match(src, /formatPromotedReply/);
  });

  it("gateway /agent/run and the stream persist when a session id is present", () => {
    const json = read("src/gateway/routes/agent-run.mjs");
    assert.match(json, /persistRun:\s*runSessionId \? true : undefined/);
    const stream = read("src/gateway/index.mjs");
    assert.match(stream, /persistRun:\s*streamSessionId \? true : undefined/);
    assert.match(stream, /stopReason:\s*result\.stopReason/);
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
});
