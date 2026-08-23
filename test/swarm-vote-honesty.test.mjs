import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Hermetic: loop tests must isolate HOME/XCLAW_STATE_DIR (session-kill lesson)
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-vh-"));
const savedHome = process.env.HOME;
const savedState = process.env.XCLAW_STATE_DIR;
let runAgentLoop, runSwarmFanOut;

before(async () => {
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  ({ runAgentLoop } = await import("../src/agent/loop.mjs"));
  ({ runSwarmFanOut } = await import("../src/agents/swarm-run.mjs"));
});
after(() => {
  process.env.HOME = savedHome;
  if (savedState === undefined) delete process.env.XCLAW_STATE_DIR;
  else process.env.XCLAW_STATE_DIR = savedState;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const BASE_CFG = {
  agent: { apiKey: "fake", model: "fake-1" },
  tokens: { ledger: false },
  hooks: { enabled: false },
};

function rescueProvider(rescueText) {
  const calls = [];
  return {
    providerName: "fake",
    model: "fake-1",
    modelRef: "fake-1",
    calls,
    async chat({ messages }) {
      calls.push(messages.map((m) => ({ role: m.role, content: String(m.content).slice(0, 80) })));
      return { message: { role: "assistant", content: rescueText }, finishReason: "stop" };
    },
  };
}

// Live failure (2026-08-14 13:04): 5-node research swarm — every node hit
// maxTurns with only the stub "Stopped after N turns", 0/5 ballots, and the
// run still reported done/ok.
describe("maxTurns final-answer rescue", () => {
  it("turn-budget exhaustion produces a best-effort final answer, not the stub", async () => {
    const provider = rescueProvider("rescued: found 3 issues so far");
    const out = await runAgentLoop({
      userMessage: "audit things",
      cfg: { ...BASE_CFG, agent: { ...BASE_CFG.agent, maxTurns: 0 } },
      provider,
    });
    const text = out.finalText ?? out.text;
    assert.match(text, /rescued: found 3 issues/);
    assert.match(text, /stopped at turn cap 0/); // wording updated in S3 (turn cap = bounded total)
    // the rescue call carried the exhaustion instruction and disabled tools
    const last = provider.calls.at(-1).at(-1);
    assert.equal(last.role, "user");
    assert.match(last.content, /Turn budget exhausted/);
  });

  it("agent.finalAnswerRescue:false keeps the legacy stub", async () => {
    const provider = rescueProvider("should not be used");
    const out = await runAgentLoop({
      userMessage: "audit things",
      cfg: { ...BASE_CFG, agent: { ...BASE_CFG.agent, maxTurns: 0, finalAnswerRescue: false } },
      provider,
    });
    assert.match(out.finalText ?? out.text, /Stopped after 0 turns/);
    assert.equal(provider.calls.length, 0, "no rescue call when disabled");
  });
});

describe("swarm vote honesty", () => {
  it("all-ballots-failed vote degrades status to partial with a loud summary line", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-vhs-"));
    const cfg = {
      paths: { configDir: dir },
      swarm: { enabled: true, maxParallel: 2, mergeEnabled: false, voteEnabled: true, voteMinBallots: 2 },
    };
    // research nodes that "succeed" but emit NO ballot (the live shape)
    const spawn = async (opts) => ({
      ok: true,
      id: `c-${Math.random().toString(36).slice(2, 6)}`,
      status: "done",
      result: { text: "Stopped after 6 turns (maxTurns).", turns: 6, workspace: null },
    });
    const out = await runSwarmFanOut(cfg, {
      goal: "audit",
      tasks: [
        { id: "a", role: "research", task: "read a" },
        { id: "b", role: "research", task: "read b" },
      ],
      spawnSubagent: spawn,
    });
    // stub-only nodes count as failures (NO_OUTPUT) → the run cannot be "done"
    assert.notEqual(out.status, "done", "stub-only nodes must not read as done");
    assert.ok(out.results.every((r) => r.code === "NO_OUTPUT"), JSON.stringify(out.results.map((r) => r.code)));
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("prose-only nodes (no ballots) still count as done — vote absence alone never degrades", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-vhs3-"));
    const cfg = {
      paths: { configDir: dir },
      swarm: { enabled: true, maxParallel: 2, mergeEnabled: false, voteEnabled: true },
    };
    const spawn = async () => ({
      ok: true,
      id: `c-${Math.random().toString(36).slice(2, 6)}`,
      status: "done",
      result: { text: "useful prose findings", turns: 2, workspace: null },
    });
    const out = await runSwarmFanOut(cfg, {
      goal: "audit",
      tasks: [
        { id: "a", role: "research", task: "read a" },
        { id: "b", role: "research", task: "read b" },
      ],
      spawnSubagent: spawn,
    });
    assert.equal(out.status, "done");
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("valid ballots keep status done", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-vhs2-"));
    const cfg = {
      paths: { configDir: dir },
      swarm: { enabled: true, maxParallel: 2, mergeEnabled: false, voteEnabled: true, voteMinBallots: 2 },
    };
    const ballot = (v) =>
      "findings...\n```xclaw-ballot\n" + JSON.stringify({ verdict: v, confidence: 0.9 }) + "\n```";
    const spawn = async () => ({
      ok: true,
      id: `c-${Math.random().toString(36).slice(2, 6)}`,
      status: "done",
      result: { text: ballot("ok"), turns: 2, workspace: null },
    });
    const out = await runSwarmFanOut(cfg, {
      goal: "audit",
      tasks: [
        { id: "a", role: "research", task: "read a" },
        { id: "b", role: "research", task: "read b" },
      ],
      spawnSubagent: spawn,
    });
    assert.equal(out.status, "done");
    await fsp.rm(dir, { recursive: true, force: true });
  });
});
