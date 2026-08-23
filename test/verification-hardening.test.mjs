import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// S5 (Master Evolution Directive) — verification + stagnation hardening:
// 1. denied tool calls feed the loop guard (repeated denied retries trip it);
// 2. the shared approval gate upgrades when security config changes
//    (singleton-freeze class, same as getSharedAlerter/3.102.1);
// 3. durable memory events log rotates at the size cap.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-vhard-"));
const savedHome = process.env.HOME;
const savedState = process.env.XCLAW_STATE_DIR;

let runAgentLoop, getSharedApprovalGate, resetSharedApprovalGate, appendMemory;

before(async () => {
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  ({ runAgentLoop } = await import("../src/agent/loop.mjs"));
  ({ getSharedApprovalGate, resetSharedApprovalGate } = await import(
    "../src/security/approvals.mjs"
  ));
  ({ appendMemory } = await import("../src/memory/durable.mjs"));
});

after(() => {
  process.env.HOME = savedHome;
  if (savedState === undefined) delete process.env.XCLAW_STATE_DIR;
  else process.env.XCLAW_STATE_DIR = savedState;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const BASE_CFG = {
  agent: { maxTurns: 10, persistTranscript: false },
  tokens: { enabled: false, ledger: false },
  skills: { enabled: false },
  memory: { enabled: false },
  computer: { autoStart: false },
  hooks: { log: false },
};

function bashLoopingProvider() {
  let n = 0;
  return {
    providerName: "fake",
    model: "fake-1",
    modelRef: "fake-1",
    baseUrl: "http://127.0.0.1:1",
    get n() {
      return n;
    },
    async chat() {
      n += 1;
      return {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: `c${n}`,
              type: "function",
              function: { name: "bash", arguments: JSON.stringify({ command: "true" }) },
            },
          ],
        },
        finishReason: "tool_calls",
      };
    },
  };
}

describe("verification + stagnation hardening (S5)", () => {
  it("repeated DENIED tool calls trip the loop guard", async () => {
    const cfg = {
      ...BASE_CFG,
      agent: {
        ...BASE_CFG.agent,
        loopGuard: {
          warningThreshold: 2,
          criticalThreshold: 3,
          globalCircuitBreakerThreshold: 3,
        },
      },
      // bash not in the allowlist → every call is denied (not_allowlisted,
      // non-pending). Before the fix, denies bypassed guard.record and the
      // model could hammer a blocked tool for the full turn budget.
      security: { autoApprove: true, allowedTools: ["file_read"] },
    };
    resetSharedApprovalGate(cfg);
    const provider = bashLoopingProvider();
    const out = await runAgentLoop({
      cfg,
      provider,
      message: "keep trying bash",
      continuation: false,
    });
    assert.equal(out.stopReason, "guard");
    assert.ok(
      provider.n < 10,
      `guard must stop denied-retry loops before the cap (got ${provider.n} turns)`
    );
  });

  it("shared approval gate upgrades when security config changes (no pendings)", () => {
    const a = resetSharedApprovalGate({ security: { autoApprove: true } });
    const b = getSharedApprovalGate({
      security: { autoApprove: false, allowedTools: ["bash"] },
    });
    assert.notEqual(a, b, "gate rebuilt for a different non-empty policy");
    const c = getSharedApprovalGate({});
    assert.equal(b, c, "bare-{} caller must NOT downgrade the gate");
    const d = getSharedApprovalGate({
      security: { autoApprove: false, allowedTools: ["bash"] },
    });
    assert.equal(b, d, "same policy → same gate");
  });

  it("memory events log rotates at the size cap", async () => {
    const ws = fs.mkdtempSync(path.join(tmpHome, "ws-rot-"));
    const cfg = {
      paths: { configDir: path.join(tmpHome, "cfgdir") },
      memory: { maxEventBytes: 4000, keepEventBytes: 1500 },
    };
    let last = null;
    for (let i = 0; i < 60; i++) {
      last = await appendMemory(cfg, ws, {
        type: "note",
        summary: `event number ${i} — ${"x".repeat(120)}`,
      });
    }
    assert.ok(last, "appends succeeded");
    // find the events file + its rotation sibling
    const walk = (d) =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]
      );
    const files = walk(path.join(tmpHome, "cfgdir"));
    const jsonl = files.find((f) => f.endsWith(".jsonl") && !f.endsWith(".jsonl.1"));
    const rotated = files.find((f) => f.endsWith(".jsonl.1"));
    assert.ok(jsonl, "events jsonl exists");
    assert.ok(rotated, "rotation sibling created");
    assert.ok(
      fs.statSync(jsonl).size <= 4000,
      `active file bounded (${fs.statSync(jsonl).size} bytes)`
    );
  });
});
