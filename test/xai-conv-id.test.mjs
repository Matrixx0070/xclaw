import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildXaiCacheHeaders } from "../src/agent/provider.mjs";

describe("x-grok-conv-id", () => {
  it("sets optimized hierarchical header for xAI baseUrl", () => {
    const h = buildXaiCacheHeaders({
      convId: "sess_abc-123",
      baseUrl: "https://api.x.ai/v1",
      cfg: { profile: "lab", agent: { model: "grok-4.3" } },
      model: "grok-4.3",
    });
    const id = h["x-grok-conv-id"];
    assert.ok(id, "header present");
    assert.ok(id.includes("sess_abc-123"), `session in key: ${id}`);
    assert.ok(id.startsWith("xclaw:"), `prefixed: ${id}`);
    assert.ok(id.includes("lab"), `profile in key: ${id}`);
    assert.ok(id.includes("grok-4.3"), `model family in key: ${id}`);
  });

  it("sets header when provider is xai", () => {
    const h = buildXaiCacheHeaders({
      convId: "run-1",
      provider: "xai",
      baseUrl: "https://example.com/v1",
      model: "grok-4.5",
      cfg: { profile: "dev" },
    });
    const id = h["x-grok-conv-id"];
    assert.ok(id);
    assert.ok(id.includes("run-1"));
    assert.ok(id.includes("grok-4.5"));
  });

  it("omits for non-xAI", () => {
    const h = buildXaiCacheHeaders({
      convId: "x",
      baseUrl: "https://api.openai.com/v1",
      provider: "openai",
    });
    assert.deepEqual(h, {});
  });

  it("omits when disabled in cfg", () => {
    const h = buildXaiCacheHeaders({
      convId: "x",
      baseUrl: "https://api.x.ai/v1",
      cfg: { tokens: { xaiConvId: false } },
    });
    assert.deepEqual(h, {});
  });

  it("sanitizes non-ascii and clamps length", () => {
    const h = buildXaiCacheHeaders({
      convId: "id-你好-" + "a".repeat(200),
      baseUrl: "https://api.x.ai/v1",
      model: "grok-4.3",
    });
    assert.ok(h["x-grok-conv-id"].length <= 128);
    assert.ok(!/[^\x20-\x7E]/.test(h["x-grok-conv-id"]));
  });

  it("raw mode when optimizeCacheKeys false", () => {
    const h = buildXaiCacheHeaders({
      convId: "raw-sess",
      baseUrl: "https://api.x.ai/v1",
      cfg: { tokens: { optimizeCacheKeys: false } },
    });
    assert.equal(h["x-grok-conv-id"], "raw-sess");
  });
});
