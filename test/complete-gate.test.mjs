import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deriveGoalVerifyChecks,
  resolveCompletionChecks,
  evaluateNaturalStopVerify,
  agentExitCode,
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
    assert.deepEqual(deriveGoalVerifyChecks("how do I create a file?"), []);
    assert.deepEqual(deriveGoalVerifyChecks("what is in config.json?"), []);
  });

  it("absolute extensionless and Makefile still derive a check", () => {
    const t = deriveGoalVerifyChecks("touch /tmp/xclaw-noext");
    assert.equal(t[0].type, "file_exists");
    assert.equal(t[0].path, "/tmp/xclaw-noext");
    const m = deriveGoalVerifyChecks("create Makefile");
    assert.equal(m[0].type, "file_exists");
    assert.equal(m[0].path, "Makefile");
    assert.deepEqual(deriveGoalVerifyChecks("what is in Makefile?"), []);
  });

  it("append TEXT to PATH and echo TEXT > PATH", () => {
    const a = deriveGoalVerifyChecks("append OK to notes.txt");
    assert.equal(a[0].type, "file_contains");
    assert.equal(a[0].path, "notes.txt");
    assert.equal(a[0].text, "OK");
    const e = deriveGoalVerifyChecks("echo AUTONOMY_OK > results/PROOF.txt");
    assert.equal(e[0].type, "file_contains");
    assert.equal(e[0].path, "results/PROOF.txt");
    assert.equal(e[0].text, "AUTONOMY_OK");
    assert.deepEqual(deriveGoalVerifyChecks("how do I append to a file?"), []);
  });

  it("write TEXT to PATH (eval / unquoted)", () => {
    const c = deriveGoalVerifyChecks("write AUTONOMY_OK to results/PROOF.txt");
    assert.equal(c[0].type, "file_contains");
    assert.equal(c[0].path, "results/PROOF.txt");
    assert.equal(c[0].text, "AUTONOMY_OK");
  });

  it("create PATH without contents is file_exists, not a chat skip", () => {
    const c = deriveGoalVerifyChecks("touch status.txt");
    assert.equal(c[0].type, "file_exists");
    assert.equal(c[0].path, "status.txt");
    const named = deriveGoalVerifyChecks("create a file named hello.txt");
    assert.equal(named[0].type, "file_exists");
    assert.equal(named[0].path, "hello.txt");
  });

  it("eval smoke: write a file PATH containing exactly TEXT", () => {
    const c = deriveGoalVerifyChecks(
      "Write a file hello.txt containing exactly: hello xclaw\nThen stop."
    );
    assert.equal(c.length, 1);
    assert.equal(c[0].type, "file_contains");
    assert.equal(c[0].path, "hello.txt");
    assert.equal(c[0].text, "hello xclaw");
    const bare = deriveGoalVerifyChecks("create file notes.md containing hi");
    assert.equal(bare[0].type, "file_contains");
    assert.equal(bare[0].path, "notes.md");
    assert.equal(bare[0].text, "hi");
  });

  it("eval smoke: create a file named PATH whose first line is TEXT", () => {
    const c = deriveGoalVerifyChecks(
      "In the current working directory, create a file named README.md whose first line is exactly: # Eval Project\nDo not create any other files. When done, stop."
    );
    assert.equal(c.length, 1);
    assert.equal(c[0].type, "file_contains");
    assert.equal(c[0].path, "README.md");
    assert.equal(c[0].text, "# Eval Project");
  });

  it("how-to still derives nothing when the smoke phrasing is a question", () => {
    assert.deepEqual(
      deriveGoalVerifyChecks("how do I write a file hello.txt containing hello?"),
      []
    );
    assert.deepEqual(
      deriveGoalVerifyChecks("explain how to create a file named README.md"),
      []
    );
  });

  it("CLI exit is nonzero for unverified / cutoff, zero for natural chat", () => {
    assert.equal(agentExitCode({ stopReason: "natural" }), 0);
    assert.equal(agentExitCode({ stopReason: "unverified" }), 1);
    assert.equal(agentExitCode({ stopReason: "maxTurns" }), 1);
    assert.equal(agentExitCode({ stopReason: "aborted" }), 1);
    assert.equal(agentExitCode({ ok: false, stopReason: "natural" }), 1);
    assert.equal(agentExitCode({ stopReason: "done" }), 0);
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

  it("smoke write-a-file rejects Done when hello.txt is missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cg-smoke-"));
    const r = await evaluateNaturalStopVerify({
      naturalStop: true,
      userMessage:
        "Write a file hello.txt containing exactly: hello xclaw\nThen stop.",
      workingDir: dir,
    });
    assert.equal(r.reject, true);
    assert.equal(r.result.ok, false);
  });

  it("smoke write-a-file accepts Done when hello.txt matches (not 'Then stop.')", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cg-smoke-ok-"));
    fs.writeFileSync(path.join(dir, "hello.txt"), "hello xclaw\n");
    const r = await evaluateNaturalStopVerify({
      naturalStop: true,
      userMessage:
        "Write a file hello.txt containing exactly: hello xclaw\nThen stop.",
      workingDir: dir,
    });
    assert.equal(r.reject, false);
    assert.equal(r.result.ok, true);
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
    assert.equal(out.ok, false);
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
    assert.notEqual(out.ok, false);
  });

  it("touch PATH is unverified when the file is missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cg-touch-"));
    const out = await runAgentLoop({
      cfg: CFG,
      provider: doneProvider(),
      userMessage: `touch ${dir}/status.txt`,
      workingDir: dir,
    });
    assert.equal(out.stopReason, "unverified");
    assert.equal(out.ok, false);
  });

  it("write a file PATH containing TEXT is unverified when missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cg-smoke-loop-"));
    const out = await runAgentLoop({
      cfg: CFG,
      provider: doneProvider(),
      userMessage:
        "Write a file hello.txt containing exactly: hello xclaw\nThen stop.",
      workingDir: dir,
    });
    assert.equal(out.stopReason, "unverified");
    assert.equal(out.ok, false);
    assert.equal(fs.existsSync(path.join(dir, "hello.txt")), false);
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
    assert.notEqual(out.ok, false);
  });
});
