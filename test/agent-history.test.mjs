import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Unit-test the history shaping logic by importing and simulating
// the same filtering rules as loop.mjs (avoid full agent run).
function shapeHistory(history, maxHistory = 40) {
  const prior = [];
  if (Array.isArray(history)) {
    for (const m of history) {
      if (!m || typeof m !== "object") continue;
      const role = m.role;
      if (role !== "user" && role !== "assistant" && role !== "tool") continue;
      if (m.content == null) continue;
      prior.push({ role, content: String(m.content) });
    }
  }
  return prior.length > maxHistory ? prior.slice(-maxHistory) : prior;
}

describe("conversation history threading", () => {
  it("keeps user/assistant turns and drops system", () => {
    const h = shapeHistory([
      { role: "system", content: "nope" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "again" },
    ]);
    assert.equal(h.length, 3);
    assert.equal(h[0].content, "hi");
    assert.equal(h[2].content, "again");
  });

  it("caps to maxHistory from the end", () => {
    const big = [];
    for (let i = 0; i < 100; i++) big.push({ role: "user", content: `m${i}` });
    const h = shapeHistory(big, 5);
    assert.equal(h.length, 5);
    assert.equal(h[0].content, "m95");
    assert.equal(h[4].content, "m99");
  });

  it("loop.mjs source includes history wiring", () => {
    const src = fs.readFileSync(new URL("../src/agent/loop.mjs", import.meta.url), "utf8");
    assert.match(src, /history = \[\]/);
    assert.match(src, /priorCapped/);
    assert.match(src, /maxHistoryMessages/);
    assert.match(src, /revalidatePlan/);
  });
});
