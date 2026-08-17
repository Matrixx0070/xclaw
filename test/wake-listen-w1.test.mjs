import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchWakePhrase } from "../src/voice/wake/index.mjs";
import { runVoiceListen } from "../src/voice/wake/listen.mjs";

describe("wake W1 listen", () => {
  it("exports runVoiceListen", () => {
    assert.equal(typeof runVoiceListen, "function");
  });

  it("aborts quickly with AbortSignal", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await runVoiceListen(
      {},
      { signal: ac.signal, speak: false, agent: false }
    );
    assert.equal(r.stopped, true);
  });

  it("wake phrases still match", () => {
    assert.equal(matchWakePhrase("hey xclaw do something").hit, true);
  });
});
