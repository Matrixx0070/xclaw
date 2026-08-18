import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactEvent, REDACTED } from "../src/security/redact-secrets.mjs";

describe("WS emit redaction", () => {
  it("strips api keys from event payloads", () => {
    const e = redactEvent({
      type: "tool",
      apiKey: "super-secret-value-12345",
      result: "xai-abcdefghijklmnopqrstuvwxyz0123456789",
    });
    assert.equal(e.apiKey, REDACTED);
    assert.ok(!JSON.stringify(e).includes("abcdefghijklmnop"));
  });
});
