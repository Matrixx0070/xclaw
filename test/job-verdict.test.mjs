import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// S2 (Master Evolution Directive): success must be EARNED, never assumed.
// - a run the runtime cut off (maxTurns) is "incomplete", not "succeeded";
// - a natural finish without verify commands is "succeeded" but verdict
//   "unverified" — and durable memory labels it job_ok_unverified;
// - verify commands that pass earn verdict "verified" → job_ok.
// Hermetic: temp HOME/state, injected fake provider, no network.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-verdict-"));
const savedHome = process.env.HOME;
const savedState = process.env.XCLAW_STATE_DIR;

let runJob, rememberJob;

before(async () => {
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  ({ runJob } = await import("../src/jobs/job.mjs"));
  ({ rememberJob } = await import("../src/memory/durable.mjs"));
});

after(() => {
  process.env.HOME = savedHome;
  if (savedState === undefined) delete process.env.XCLAW_STATE_DIR;
  else process.env.XCLAW_STATE_DIR = savedState;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const CFG = {
  agent: { maxTurns: 3, persistTranscript: false },
  // Claims gate off: these tests probe the verdict LADDER, not grounding.
  jobs: { requireStructuredClaims: false },
  tokens: { enabled: false, ledger: false },
  skills: { enabled: false, proposeOnSuccess: false, proposeOnFail: false },
  memory: { enabled: false },
  computer: { autoStart: false },
  security: { autoApprove: true },
  hooks: { log: false },
};

function textProvider(reply) {
  return {
    providerName: "fake",
    model: "fake-1",
    modelRef: "fake-1",
    baseUrl: "http://127.0.0.1:1",
    async chat() {
      return {
        message: { role: "assistant", content: reply },
        finishReason: "stop",
      };
    },
  };
}

function toolLoopingProvider() {
  let n = 0;
  return {
    providerName: "fake",
    model: "fake-1",
    modelRef: "fake-1",
    baseUrl: "http://127.0.0.1:1",
    async chat() {
      n += 1;
      return {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: `call_${n}`,
              type: "function",
              // Vary args each call so the loop guard does not stop the run
              // before maxTurns — this test is about the CAP, not the guard.
              function: { name: "bash", arguments: JSON.stringify({ command: `echo ${n}` }) },
            },
          ],
        },
        finishReason: "tool_calls",
      };
    },
  };
}

describe("job verdict provenance (S2)", () => {
  it("maxTurns cutoff without verify → status incomplete, pass false", async () => {
    const ws = fs.mkdtempSync(path.join(tmpHome, "ws-a-"));
    const job = await runJob({
      goal: "loop forever",
      cfg: CFG,
      workspace: ws,
      provider: toolLoopingProvider(),
      persistRun: false,
    });
    assert.equal(job.stopReason, "maxTurns");
    assert.equal(job.status, "incomplete");
    assert.equal(job.pass, false);
    assert.equal(job.verdict, "incomplete");
  });

  it("natural finish without verify → succeeded but verdict unverified", async () => {
    const ws = fs.mkdtempSync(path.join(tmpHome, "ws-b-"));
    const job = await runJob({
      goal: "say done",
      cfg: CFG,
      workspace: ws,
      provider: textProvider("All done."),
      persistRun: false,
    });
    assert.equal(job.status, "succeeded");
    assert.equal(job.pass, true);
    assert.equal(job.verdict, "unverified");
  });

  it("passing verify commands → verdict verified", async () => {
    const ws = fs.mkdtempSync(path.join(tmpHome, "ws-c-"));
    fs.writeFileSync(path.join(ws, "out.txt"), "ok");
    const job = await runJob({
      goal: "produce out.txt",
      cfg: CFG,
      workspace: ws,
      provider: textProvider("Wrote out.txt."),
      verify: [{ type: "file_exists", path: "out.txt" }],
      persistRun: false,
    });
    assert.equal(job.status, "succeeded");
    assert.equal(job.verdict, "verified");
  });

  it("rememberJob labels unverified passes job_ok_unverified", async () => {
    const mkJob = (verdict, pass) => ({
      workspace: path.join(tmpHome, "ws-mem"),
      goal: "g",
      status: pass ? "succeeded" : "failed",
      pass,
      verdict,
      turns: 1,
      id: `j_${verdict}`,
    });
    fs.mkdirSync(path.join(tmpHome, "ws-mem"), { recursive: true });
    const cfg = { ...CFG, memory: { enabled: true } };
    const a = await rememberJob(cfg, mkJob("verified", true));
    const b = await rememberJob(cfg, mkJob("unverified", true));
    const c = await rememberJob(cfg, mkJob("failed", false));
    assert.equal(a.type, "job_ok");
    assert.equal(b.type, "job_ok_unverified");
    assert.equal(c.type, "job_fail");
  });
});
