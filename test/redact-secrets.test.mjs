/**
 * Secret redaction for traces / logs / events.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REDACTED,
  redactString,
  redactValue,
  redactToolTraceEntry,
  redactToolTrace,
} from "../src/security/redact-secrets.mjs";

describe("redactString", () => {
  it("redacts xAI and OpenAI style keys", () => {
    const s = redactString(
      "key=xai-Oy56JMhhEmserGvJ49DL6J9eWXmUmMPBccqO2SzzaCNLC8CNtAu6r19nfz7FJgsa"
    );
    assert.ok(!s.includes("Oy56JMhh"));
    assert.ok(s.includes(REDACTED));
    const s2 = redactString("sk-abcdefghijklmnopqrstuvwxyz0123456789");
    assert.ok(s2.includes(REDACTED));
  });

  it("redacts Bearer tokens", () => {
    const s = redactString(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb"
    );
    assert.ok(!s.includes("eyJhbGci"));
    assert.ok(s.includes(REDACTED));
  });

  it("redacts env style", () => {
    const s = redactString("XAI_API_KEY=xai-abcdefghijklmnopqrstuvwxyz012345");
    assert.ok(s.includes("XAI_API_KEY"));
    assert.ok(s.includes(REDACTED));
  });
});

describe("redactValue / toolTrace", () => {
  it("redacts sensitive keys in objects", () => {
    const o = redactValue({
      apiKey: "super-secret-value-12345",
      safe: "hello",
      nested: { token: "abc123456789" },
    });
    assert.equal(o.apiKey, REDACTED);
    assert.equal(o.safe, "hello");
    assert.equal(o.nested.token, REDACTED);
  });

  it("redacts toolTrace result text", () => {
    const e = redactToolTraceEntry({
      name: "xclaw_bash",
      args: { command: "echo xai-abcdefghijklmnopqrstuvwxyz0123456789" },
      result: "token=xai-abcdefghijklmnopqrstuvwxyz0123456789",
    });
    assert.ok(!JSON.stringify(e).includes("abcdefghijklmnop"));
    const trace = redactToolTrace([e]);
    assert.equal(trace.length, 1);
  });
});
