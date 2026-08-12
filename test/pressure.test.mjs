import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  measureContextPressure,
  pressureToEvictionTweaks,
} from "../src/tokens/pressure.mjs";

describe("context pressure", () => {
  it("low for small transcript", () => {
    const p = measureContextPressure(
      [{ role: "system", content: "x" }, { role: "user", content: "hi" }],
      { maxChars: 10000, maxMessages: 40 }
    );
    assert.ok(p.pressure < 0.4);
    assert.equal(p.band, "low");
  });
  it("critical near budget", () => {
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: "tool",
      content: "y".repeat(5000),
    }));
    const p = measureContextPressure(msgs, { maxChars: 100000, maxMessages: 40 });
    assert.ok(p.pressure >= 0.65);
    const t = pressureToEvictionTweaks(p);
    assert.ok(t.toolMaxChars);
  });
});
