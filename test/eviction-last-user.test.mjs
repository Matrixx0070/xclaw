import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { slidingWindowEvict } from "../src/tokens/sliding-window.mjs";
import { evictMessages } from "../src/tokens/eviction.mjs";

// Faithful repro of the live 2026-08-14 11:57 failure: one DM turn ran 14
// file_reads (28 messages); the triggering user message slid out of the
// window MID-TURN and the model replied "your message came through empty"
// to a non-empty message.
function heavyToolTurn(ask, toolTurns) {
  const msgs = [{ role: "system", content: "sys" }, { role: "user", content: ask }];
  for (let i = 0; i < toolTurns; i++) {
    msgs.push({
      role: "assistant",
      content: "",
      tool_calls: [{ id: `c${i}`, function: { name: "xclaw_file_read", arguments: "{}" } }],
    });
    msgs.push({ role: "tool", tool_call_id: `c${i}`, content: `result ${i} ${"x".repeat(120)}` });
  }
  return msgs;
}

describe("eviction protects the current user ask", () => {
  it("pair-aware sliding window retains the last user message mid-turn", () => {
    const msgs = heavyToolTurn("Diagnose why xclaw_bash failed", 25); // 50 tool msgs
    const r = slidingWindowEvict(msgs, { maxMessages: 40, protectRecent: 4, insertSummary: false });
    const users = r.messages.filter((m) => m.role === "user");
    assert.equal(users.length, 1, "the ask must survive");
    assert.equal(users[0].content, "Diagnose why xclaw_bash failed");
    assert.ok(r.report.actions.some((a) => a.type === "retain"), "retain action reported");
    // still respects the budget apart from the one retained message
    assert.ok(r.messages.length <= 42, `window blown: ${r.messages.length}`);
  });

  it("non-pair-aware path retains it too", () => {
    const msgs = heavyToolTurn("the ask", 25);
    const r = slidingWindowEvict(msgs, { maxMessages: 40, pairAware: false, insertSummary: false });
    assert.ok(r.messages.some((m) => m.role === "user" && m.content === "the ask"));
  });

  it("full hybrid policy (live gateway shape) retains the ask", () => {
    const msgs = heavyToolTurn("hybrid ask", 30);
    const r = evictMessages(msgs, { policy: "hybrid", maxMessages: 40, maxChars: 120000, toolMaxChars: 2000 });
    assert.ok(r.messages.some((m) => m.role === "user" && m.content === "hybrid ask"));
  });

  it("does not resurrect stale asks when a newer user message is kept", () => {
    const msgs = heavyToolTurn("old ask", 25);
    msgs.push({ role: "user", content: "new ask" });
    const r = slidingWindowEvict(msgs, { maxMessages: 40, protectRecent: 4, insertSummary: false });
    const users = r.messages.filter((m) => m.role === "user").map((m) => m.content);
    assert.ok(users.includes("new ask"));
    assert.ok(!users.includes("old ask"), "superseded ask must not be force-retained");
  });

  it("eviction notices are not treated as real user messages", () => {
    const msgs = heavyToolTurn("real ask", 25);
    msgs.splice(2, 0, { role: "user", content: "[XClaw sliding_window] Evicted 3 earlier messages" });
    const r = slidingWindowEvict(msgs, { maxMessages: 40, protectRecent: 4, insertSummary: false });
    const users = r.messages.filter((m) => m.role === "user").map((m) => m.content);
    assert.ok(users.includes("real ask"));
  });
});
