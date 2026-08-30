import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSubagent, createSpawnTool } from "../src/agents/spawn.mjs";

describe("spawnSubagent does not treat a child's false Done as success", () => {
  const CFG = {
    agent: {
      maxTurns: 4,
      persistTranscript: false,
      continueOnMaxTurns: false,
      finalAnswerRescue: false,
    },
    tokens: { enabled: false, ledger: false },
    skills: { enabled: false },
    memory: { enabled: false, recall: false },
    computer: { autoStart: false },
    security: { autoApprove: true },
    hooks: { log: false, stopBlockCap: 2 },
    router: { enabled: false },
  };

  function doneProvider() {
    return {
      providerName: "fake",
      model: "fake-1",
      modelRef: "fake-1",
      baseUrl: "http://127.0.0.1:1",
      async chat() {
        return {
          message: { role: "assistant", content: "Done." },
          finishReason: "stop",
        };
      },
    };
  }

  it("returns ok:false when the child claims Done and the file is missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-spawn-miss-"));
    const out = await spawnSubagent({
      task: `Create ${dir}/proof.txt with text PROOF`,
      cfg: CFG,
      workingDir: dir,
      provider: doneProvider(),
      maxTurns: 4,
    });
    assert.equal(out.ok, false);
    assert.equal(out.status, "failed");
    assert.equal(out.result?.stopReason, "unverified");
    assert.equal(fs.existsSync(path.join(dir, "proof.txt")), false);
  });

  it("returns ok:true for a child chat question", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-spawn-chat-"));
    const out = await spawnSubagent({
      task: "what is 2+2?",
      cfg: CFG,
      workingDir: dir,
      provider: doneProvider(),
      maxTurns: 4,
    });
    assert.equal(out.ok, true);
    assert.equal(out.status, "done");
  });
});

describe("xclaw_spawn_subagent tool reports why the child failed", () => {
  it("includes stopReason when the child is unverified", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-spawn-tool-"));
    const tool = createSpawnTool({
      cfg: {
        agent: {
          maxTurns: 4,
          persistTranscript: false,
          continueOnMaxTurns: false,
          finalAnswerRescue: false,
        },
        tokens: { enabled: false, ledger: false },
        skills: { enabled: false },
        memory: { enabled: false, recall: false },
        computer: { autoStart: false },
        security: { autoApprove: true },
        hooks: { log: false, stopBlockCap: 2 },
        router: { enabled: false },
      },
      workingDir: dir,
      provider: {
        providerName: "fake",
        model: "fake-1",
        modelRef: "fake-1",
        baseUrl: "http://127.0.0.1:1",
        async chat() {
          return {
            message: { role: "assistant", content: "Done." },
            finishReason: "stop",
          };
        },
      },
    });
    const out = await tool.execute({
      task: `Create ${dir}/proof.txt with text PROOF`,
      maxTurns: 4,
    });
    assert.equal(out.isError, true);
    const text = out.content.map((c) => c.text).join("\n");
    assert.match(text, /stopReason=unverified/);
  });
});
