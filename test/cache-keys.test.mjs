
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  modelCacheFamily,
  buildCacheRoutingKey,
  buildProviderCacheHeaders,
  toolPackFingerprint,
} from "../src/tokens/cache-keys.mjs";
import { buildXaiCacheHeaders } from "../src/agent/provider.mjs";

describe("optimized cache keys", () => {
  it("coarsens model families", () => {
    assert.equal(modelCacheFamily("grok-4.5"), "grok-4.5");
    assert.equal(modelCacheFamily("grok-4.3"), "grok-4.3");
    assert.equal(modelCacheFamily("claude-sonnet-5"), "claude-sonnet");
  });

  it("builds stable hierarchical keys", () => {
    const a = buildCacheRoutingKey({
      sessionId: "job-42",
      model: "grok-4.3",
      profile: "lab",
    });
    const b = buildCacheRoutingKey({
      sessionId: "job-42",
      model: "grok-4.3",
      profile: "lab",
    });
    assert.equal(a, b);
    assert.ok(a.startsWith("xclaw:lab:grok-4.3:"));
    assert.ok(a.includes("job-42"));
  });

  it("isolates different models", () => {
    const a = buildCacheRoutingKey({ sessionId: "s", model: "grok-4.3", profile: "lab" });
    const b = buildCacheRoutingKey({ sessionId: "s", model: "grok-4.5", profile: "lab" });
    assert.notEqual(a, b);
  });

  it("hashes long session ids", () => {
    const long = "x".repeat(80);
    const k = buildCacheRoutingKey({ sessionId: long, model: "grok-4.3", profile: "lab" });
    assert.ok(k.length <= 128);
    assert.ok(!k.includes("x".repeat(50)));
  });

  it("tool pack changes key when provided", () => {
    const a = buildCacheRoutingKey({ sessionId: "s", model: "grok-4.3", toolPack: "a,b" });
    const b = buildCacheRoutingKey({ sessionId: "s", model: "grok-4.3", toolPack: "a,c" });
    assert.notEqual(a, b);
  });

  it("buildXaiCacheHeaders emits optimized key", () => {
    const h = buildXaiCacheHeaders({
      convId: "sess-1",
      model: "grok-4.3",
      baseUrl: "https://api.x.ai/v1",
      provider: "xai",
      cfg: { profile: "lab" },
    });
    assert.ok(h["x-grok-conv-id"]);
    assert.ok(h["x-grok-conv-id"].includes("grok-4.3"));
    assert.ok(h["x-grok-conv-id"].includes("lab"));
  });

  it("provider headers empty for non-xai", () => {
    const { headers } = buildProviderCacheHeaders({
      sessionId: "s",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
    });
    assert.deepEqual(headers, {});
  });
});
