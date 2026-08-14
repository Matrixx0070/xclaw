
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeReasoningEffort,
  resolveReasoningEffort,
  isReasoningConfigured,
  REASONING_EFFORTS,
} from "../src/tokens/reasoning-effort.mjs";

describe("reasoning effort xhigh", () => {
  it("lists xhigh among allowed efforts", () => {
    assert.ok(REASONING_EFFORTS.includes("xhigh"));
  });

  it("normalizes xhigh aliases", () => {
    assert.equal(normalizeReasoningEffort("xhigh"), "xhigh");
    assert.equal(normalizeReasoningEffort("x-high"), "xhigh");
    assert.equal(normalizeReasoningEffort("max"), "xhigh");
  });

  it("coerces xhigh to high for grok-4.5 by default", () => {
    assert.equal(
      normalizeReasoningEffort("xhigh", { model: "grok-4.5" }),
      "high"
    );
  });

  it("keeps xhigh for grok-4.6", () => {
    assert.equal(
      normalizeReasoningEffort("xhigh", { model: "grok-4.6" }),
      "xhigh"
    );
  });

  it("resolveReasoningEffort reads cfg and call override", () => {
    const cfg = { agent: { reasoning: { effort: "medium" } } };
    assert.equal(resolveReasoningEffort({ cfg, model: "grok-4.5" }), "medium");
    assert.equal(
      resolveReasoningEffort({ cfg, model: "grok-4.6", callEffort: "xhigh" }),
      "xhigh"
    );
  });

  it("isReasoningConfigured detects effort-only", () => {
    assert.equal(isReasoningConfigured({ effort: "xhigh" }), true);
    assert.equal(isReasoningConfigured({ enabled: true }), true);
    assert.equal(isReasoningConfigured({}), false);
  });
});
