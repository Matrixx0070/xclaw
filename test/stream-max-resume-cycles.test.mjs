/**
 * Stream resume max cycles: finite max rejects infinite reconnect loops.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createResumingStreamClient } from "../src/client/stream-resume-client.mjs";
import { resolveStreamOptsFromConfig } from "../src/gateway/stream-resume.mjs";

describe("stream max resume cycles", () => {
  it("config default maxResumeCycles is finite", () => {
    const o = resolveStreamOptsFromConfig({});
    assert.ok(Number.isFinite(o.maxResumeCycles));
    assert.ok(o.maxResumeCycles > 0, "server default must bound reconnect loops");
  });

  it("maxResumeCycles=1 stops with MAX_RESUME_CYCLES", async () => {
    let calls = 0;
    const client = createResumingStreamClient({
      kind: "agent",
      body: { message: "loop" },
      format: "ndjson",
      baseMs: 1,
      maxMs: 5,
      strategy: "none",
      maxAttempts: 1,
      maxResumeCycles: 1,
      fetchImpl: async () => {
        calls += 1;
        throw Object.assign(new Error("drop"), { code: "TRANSIENT", retryable: true });
      },
    });
    await assert.rejects(() => client.start(), (err) => {
      assert.equal(err.code, "MAX_RESUME_CYCLES");
      assert.equal(err.retryable, false);
      return true;
    });
    assert.ok(calls >= 1);
    assert.ok(calls <= 4, `expected bounded attempts, got ${calls}`);
  });

  it("maxResumeCycles=2 allows more fetch attempts than max=1", async () => {
    let calls1 = 0;
    const c1 = createResumingStreamClient({
      kind: "agent",
      body: { message: "a" },
      format: "ndjson",
      baseMs: 1,
      maxMs: 5,
      strategy: "none",
      maxAttempts: 1,
      maxResumeCycles: 1,
      fetchImpl: async () => {
        calls1 += 1;
        throw Object.assign(new Error("drop"), { code: "TRANSIENT" });
      },
    });
    await assert.rejects(() => c1.start(), () => true);

    let calls2 = 0;
    const c2 = createResumingStreamClient({
      kind: "agent",
      body: { message: "b" },
      format: "ndjson",
      baseMs: 1,
      maxMs: 5,
      strategy: "none",
      maxAttempts: 1,
      maxResumeCycles: 2,
      fetchImpl: async () => {
        calls2 += 1;
        throw Object.assign(new Error("drop"), { code: "TRANSIENT" });
      },
    });
    await assert.rejects(() => c2.start(), (err) => err.code === "MAX_RESUME_CYCLES");
    assert.ok(calls2 > calls1, `cycles=2 should attempt more (${calls2} vs ${calls1})`);
  });
});
