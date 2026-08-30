import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deriveGoalVerifyChecks,
  resolveCompletionChecks,
  evaluateNaturalStopVerify,
} from "../src/agent/complete-gate.mjs";

describe("deriveGoalVerifyChecks", () => {
  it("derives file_contains from the README one-shot goal", () => {
    const c = deriveGoalVerifyChecks("Create /tmp/xclaw-hello.txt with text ok");
    assert.equal(c.length, 1);
    assert.equal(c[0].type, "file_contains");
    assert.equal(c[0].path, "/tmp/xclaw-hello.txt");
    assert.equal(c[0].text, "ok");
  });

  it("does not derive checks from a question", () => {
    assert.deepEqual(deriveGoalVerifyChecks("what is 2+2?"), []);
    assert.deepEqual(deriveGoalVerifyChecks("explain how files work"), []);
  });

  it("explicit verify[] wins over derivation", () => {
    const explicit = [{ type: "file_exists", path: "a.txt" }];
    assert.deepEqual(
      resolveCompletionChecks({
        verify: explicit,
        userMessage: "Create /tmp/x.txt with text z",
      }),
      explicit
    );
  });
});

describe("evaluateNaturalStopVerify", () => {
  it("does not reject a natural stop with no checks (chat)", async () => {
    const r = await evaluateNaturalStopVerify({
      naturalStop: true,
      userMessage: "hello",
      workingDir: os.tmpdir(),
    });
    assert.equal(r.reject, false);
  });

  it("rejects Done when the named file is missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cg-"));
    const r = await evaluateNaturalStopVerify({
      naturalStop: true,
      userMessage: `Create ${dir}/hello.txt with text ok`,
      workingDir: dir,
    });
    assert.equal(r.reject, true);
    assert.match(r.notice, /NOT done/i);
    assert.equal(r.result.ok, false);
  });

  it("accepts Done when the named file matches", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cg-"));
    fs.writeFileSync(path.join(dir, "hello.txt"), "ok\n");
    const r = await evaluateNaturalStopVerify({
      naturalStop: true,
      userMessage: `Create ${dir}/hello.txt with text ok`,
      workingDir: dir,
    });
    assert.equal(r.reject, false);
    assert.equal(r.result.ok, true);
  });

  it("verifyOnComplete:false skips even a file goal", async () => {
    const r = await evaluateNaturalStopVerify({
      naturalStop: true,
      userMessage: "Create /tmp/nope.txt with text x",
      cfg: { agent: { verifyOnComplete: false } },
      workingDir: os.tmpdir(),
    });
    assert.equal(r.reject, false);
  });
});

describe("loop rejects a false Done on a file goal", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cg-loop-"));
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
    agent: { maxTurns: 4, persistTranscript: false, continueOnMaxTurns: false, finalAnswerRescue: false },
    tokens: { enabled: false, ledger: false },
    skills: { enabled: false },
    memory: { enabled: false },
    computer: { autoStart: false },
    security: { autoApprove: true },
    hooks: { log: false, stopBlockCap: 2 },
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

  it("stopReason is unverified when the model claims done and the file is missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cg-miss-"));
    const events = [];
    const out = await runAgentLoop({
      cfg: CFG,
      provider: doneProvider(),
      userMessage: `Create ${dir}/proof.txt with text PROOF`,
      workingDir: dir,
      onEvent: (e) => events.push(e),
    });
    assert.equal(out.stopReason, "unverified");
    assert.ok(events.some((e) => e.type === "verify" && e.phase === "reject"));
    assert.equal(fs.existsSync(path.join(dir, "proof.txt")), false);
  });

  it("a question still completes naturally without checks", async () => {
    const out = await runAgentLoop({
      cfg: CFG,
      provider: doneProvider(),
      userMessage: "what is 2+2?",
      workingDir: tmpHome,
    });
    assert.equal(out.stopReason, "natural");
  });

  it("stopReason is natural when the named file already satisfies the check", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cg-hit-"));
    fs.writeFileSync(path.join(dir, "proof.txt"), "PROOF\n");
    const out = await runAgentLoop({
      cfg: CFG,
      provider: doneProvider(),
      userMessage: `Create ${dir}/proof.txt with text PROOF`,
      workingDir: dir,
    });
    assert.equal(out.stopReason, "natural");
  });
});
