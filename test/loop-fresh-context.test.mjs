import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Hermetic HOME (session-kill lesson)
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-fresh-"));
const savedHome = process.env.HOME;
const savedState = process.env.XCLAW_STATE_DIR;
let runAgentLoop, appendTranscript;

before(async () => {
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
  ({ runAgentLoop } = await import("../src/agent/loop.mjs"));
  ({ appendTranscript } = await import("../src/sessions/transcript.mjs"));
});
after(() => {
  process.env.HOME = savedHome;
  if (savedState === undefined) delete process.env.XCLAW_STATE_DIR;
  else process.env.XCLAW_STATE_DIR = savedState;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const CFG = { agent: { apiKey: "fake", model: "fake-1" }, tokens: { ledger: false }, hooks: { enabled: false } };

function fakeProvider() {
  const calls = [];
  return {
    providerName: "fake",
    model: "fake-1",
    modelRef: "fake-1",
    calls,
    async chat({ messages }) {
      calls.push(messages.map((m) => ({ role: m.role, content: String(m.content).slice(0, 60) })));
      return { message: { role: "assistant", content: "ok" }, finishReason: "stop" };
    },
  };
}

// Objective segments pass history: [] for a FRESH context — the durable
// mission state is the memory. Before this fix the loop treated an empty
// array as "no history passed" and silently replayed the prior segment's
// transcript, reintroducing the context-window dependency.
describe("explicit empty history = fresh context", () => {
  it("history: [] suppresses transcript replay; omitted history still loads it", async () => {
    const sid = "objective-obj_fresh_test";
    appendTranscript(CFG, sid, { role: "user", content: "PRIOR SEGMENT USER TURN" });
    appendTranscript(CFG, sid, { role: "assistant", content: "PRIOR SEGMENT REPLY" });

    const p1 = fakeProvider();
    await runAgentLoop({ userMessage: "segment 2 prompt", cfg: CFG, provider: p1, chatSessionId: sid, history: [] });
    const flat1 = JSON.stringify(p1.calls[0]);
    assert.ok(!flat1.includes("PRIOR SEGMENT"), "fresh context must not replay the transcript");

    const p2 = fakeProvider();
    await runAgentLoop({ userMessage: "normal turn", cfg: CFG, provider: p2, chatSessionId: sid });
    const flat2 = JSON.stringify(p2.calls[0]);
    assert.ok(flat2.includes("PRIOR SEGMENT USER TURN"), "default callers keep transcript history");
  });
});
