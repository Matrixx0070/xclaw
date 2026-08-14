import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildXaiCacheHeaders } from "../src/agent/provider.mjs";

describe("x-grok-conv-id", () => {
  it("sets header for xAI baseUrl", () => {
    const h = buildXaiCacheHeaders({
      convId: "sess_abc-123",
      baseUrl: "https://api.x.ai/v1",
    });
    assert.equal(h["x-grok-conv-id"], "sess_abc-123");
  });

  it("sets header when provider is xai", () => {
    const h = buildXaiCacheHeaders({
      convId: "run-1",
      provider: "xai",
      baseUrl: "https://example.com/v1",
    });
    assert.equal(h["x-grok-conv-id"], "run-1");
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
    });
    assert.ok(h["x-grok-conv-id"].length <= 128);
    assert.ok(!/[^\x20-\x7E]/.test(h["x-grok-conv-id"]));
  });
});
