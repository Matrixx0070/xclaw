import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactEvent, REDACTED } from "../src/security/redact-secrets.mjs";

describe("SSE payload redaction", () => {
  it("matches WS redactEvent contract", () => {
    const e = redactEvent({
      apiKey: "super-secret-value-12345",
      result: "xai-abcdefghijklmnopqrstuvwxyz0123456789",
    });
    assert.equal(e.apiKey, REDACTED);
    assert.ok(!JSON.stringify(e).includes("abcdefghijklmnop"));
  });
});
