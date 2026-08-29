import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveRunPersistId,
  loadAgentRun,
} from "../src/agent/run-store.mjs";

describe("resolveRunPersistId", () => {
  it("prefers sessionId, then runId, then chatSessionId", () => {
    assert.equal(resolveRunPersistId({ sessionId: "s", chatSessionId: "c" }), "s");
    assert.equal(resolveRunPersistId({ runId: "r", chatSessionId: "c" }), "r");
    assert.equal(resolveRunPersistId({ chatSessionId: "c" }), "c");
  });

  it("chatSessionId alone is enough (the default-surface identity)", () => {
    assert.equal(resolveRunPersistId({ chatSessionId: "cli-abc" }), "cli-abc");
  });

  it("persistRun:false is the explicit opt-out even with an id", () => {
    assert.equal(
      resolveRunPersistId({ chatSessionId: "c", persistRun: false }),
      null
    );
    assert.equal(resolveRunPersistId({ sessionId: "s", persistRun: false }), null);
  });

  it("persistRun:true with no id asks the caller to generate one", () => {
    assert.equal(resolveRunPersistId({ persistRun: true }), "");
  });

  it("nothing set → do not persist", () => {
    assert.equal(resolveRunPersistId({}), null);
    assert.equal(resolveRunPersistId({ persistRun: undefined }), null);
  });
});

describe("loop persists under chatSessionId", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-persist-"));
  const savedHome = process.env.HOME;
  const savedState = process.env.XCLAW_STATE_DIR;
  let runAgentLoop;

  before(async () => {
    process.env.HOME = tmpHome;
    process.env.XCLAW_STATE_DIR = tmpHome;
    ({ runAgentLoop } = await import("../src/agent/loop.mjs"));
  });

  after(() => {
    process.env.HOME = savedHome;
    if (savedState === undefined) delete process.env.XCLAW_STATE_DIR;
    else process.env.XCLAW_STATE_DIR = savedState;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  const CFG = {
    paths: { configDir: tmpHome },
    agent: { maxTurns: 2, persistTranscript: false },
    tokens: { enabled: false, ledger: false },
    skills: { enabled: false },
    memory: { enabled: false },
    computer: { autoStart: false },
    security: { autoApprove: true },
    hooks: { log: false },
  };

  function textProvider() {
    return {
      providerName: "fake",
      model: "fake-1",
      modelRef: "fake-1",
      baseUrl: "http://127.0.0.1:1",
      async chat() {
        return {
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        };
      },
    };
  }

  it("a run identified only by chatSessionId writes a durable snapshot", async () => {
    const out = await runAgentLoop({
      cfg: CFG,
      provider: textProvider(),
      userMessage: "hello",
      chatSessionId: "cli-only-chat",
    });
    assert.equal(out.stopReason, "natural");
    const saved = await loadAgentRun(CFG, "cli-only-chat");
    assert.equal(saved.ok, true, saved.message || saved.code);
    assert.equal(saved.run.status, "completed");
    assert.equal(saved.run.stopReason, "natural");
    assert.equal(saved.run.sessionId, "cli-only-chat");
  });

  it("persistRun:false skips the snapshot even when chatSessionId is set", async () => {
    const out = await runAgentLoop({
      cfg: CFG,
      provider: textProvider(),
      userMessage: "hello",
      chatSessionId: "cli-opt-out",
      persistRun: false,
    });
    assert.equal(out.stopReason, "natural");
    const saved = await loadAgentRun(CFG, "cli-opt-out");
    assert.equal(saved.ok, false);
    assert.equal(saved.code, "SESSION_NOT_FOUND");
  });
});
