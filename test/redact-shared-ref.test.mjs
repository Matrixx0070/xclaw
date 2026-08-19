import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactValue } from "../src/security/redact-secrets.mjs";

describe("redactValue shared references", () => {
  it("keeps a value that appears twice in different branches", () => {
    // regression: the webchat result carries `suggestions` and
    // `reply.suggestions` as the SAME array. The walker tracked every object
    // ever seen instead of the ancestor path, so the second occurrence became
    // the string "[Circular]" — which the UI then rendered one chip per letter.
    const shared = [{ id: "sug_1", label: "Commit 43 changes" }];
    const out = redactValue({ suggestions: shared, reply: { suggestions: shared } });
    assert.ok(Array.isArray(out.suggestions), "top-level must stay an array");
    assert.ok(Array.isArray(out.reply.suggestions), "nested copy must stay an array");
    assert.equal(out.suggestions[0].label, "Commit 43 changes");
    assert.equal(out.reply.suggestions[0].label, "Commit 43 changes");
  });

  it("still detects a genuine cycle", () => {
    const cyc = { name: "root" };
    cyc.self = cyc;
    assert.equal(redactValue(cyc).self, "[Circular]");

    const a = { name: "a" };
    const b = { name: "b", a };
    a.b = b;
    assert.equal(redactValue(a).b.a, "[Circular]");
  });

  it("still redacts credential-shaped keys at any depth", () => {
    const out = redactValue({ api_key: "abc123", nested: { token: "xyz", ok: "keep" } });
    assert.notEqual(out.api_key, "abc123");
    assert.notEqual(out.nested.token, "xyz");
    assert.equal(out.nested.ok, "keep");
  });

  it("handles a value repeated many times without flagging it", () => {
    const shared = { k: "v" };
    const out = redactValue({ a: shared, b: shared, c: { d: shared } });
    for (const got of [out.a, out.b, out.c.d]) {
      assert.deepEqual(got, { k: "v" });
    }
  });
});
