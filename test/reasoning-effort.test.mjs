
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeReasoningEffort,
  resolveReasoningEffort,
  resolveReasoningEffortMeta,
  isReasoningConfigured,
  coerceReasoningEffort,
  modelReasoningCapabilities,
  REASONING_EFFORTS,
} from "../src/tokens/reasoning-effort.mjs";

describe("reasoning effort xhigh coercion", () => {
  it("lists xhigh among allowed efforts", () => {
    assert.ok(REASONING_EFFORTS.includes("xhigh"));
  });

  it("capabilities: 4.5 no xhigh, 4.6 yes, multi-agent yes", () => {
    assert.equal(modelReasoningCapabilities("grok-4.5").supportsXhigh, false);
    assert.equal(modelReasoningCapabilities("grok-4.6").supportsXhigh, true);
    assert.equal(
      modelReasoningCapabilities("grok-4.20-multi-agent-0309").supportsXhigh,
      true
    );
  });

  it("capabilities: non-reasoning supportsEffort false", () => {
    const c = modelReasoningCapabilities("grok-4.20-0309-non-reasoning");
    assert.equal(c.supportsEffort, false);
  });

  it("coerce xhigh→high for grok-4.5", () => {
    const r = coerceReasoningEffort("xhigh", "grok-4.5");
    assert.equal(r.effort, "high");
    assert.equal(r.coerced, true);
    assert.match(r.reason, /xhigh→high/);
  });

  it("keeps xhigh for grok-4.6", () => {
    const r = coerceReasoningEffort("xhigh", "grok-4.6");
    assert.equal(r.effort, "xhigh");
    assert.equal(r.coerced, false);
  });

  it("omits effort on non-reasoning models", () => {
    const r = coerceReasoningEffort("high", "grok-4.20-0309-non-reasoning");
    assert.equal(r.effort, null);
    assert.equal(r.coerced, true);
  });

  it("normalizeReasoningEffort coerces 4.5", () => {
    assert.equal(
      normalizeReasoningEffort("xhigh", { model: "grok-4.5" }),
      "high"
    );
  });

  it("can disable coercion", () => {
    assert.equal(
      normalizeReasoningEffort("xhigh", {
        model: "grok-4.5",
        coerceXhigh: false,
      }),
      "xhigh"
    );
  });

  it("resolveReasoningEffortMeta reports coercion", () => {
    const meta = resolveReasoningEffortMeta({
      cfg: { agent: { reasoning: { effort: "xhigh" } } },
      model: "grok-4.5",
    });
    assert.equal(meta.effort, "high");
    assert.equal(meta.coerced, true);
  });

  it("resolve call override beats cfg", () => {
    const cfg = { agent: { reasoning: { effort: "medium" } } };
    assert.equal(
      resolveReasoningEffort({ cfg, model: "grok-4.6", callEffort: "xhigh" }),
      "xhigh"
    );
  });

  it("isReasoningConfigured", () => {
    assert.equal(isReasoningConfigured({ effort: "xhigh" }), true);
    assert.equal(isReasoningConfigured({}), false);
  });
});
