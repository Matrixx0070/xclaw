import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { postStopSigned, buildStopSignResult } from "../src/cli/stop-sign.mjs";

describe("stop --post offline exit", () => {
  it("maps ECONNREFUSED to gateway_offline", async () => {
    const signed = buildStopSignResult({ gateway: { token: "t" } }, { dryRun: true });
    const live = await postStopSigned(signed, {
      fetchImpl: async () => {
        const e = new Error("fetch failed");
        e.cause = { code: "ECONNREFUSED" };
        throw e;
      },
    });
    assert.equal(live.ok, false);
    assert.equal(live.code, "GATEWAY_OFFLINE");
  });
  it("maps abort to timeout", async () => {
    const signed = buildStopSignResult({ gateway: { token: "t" } }, { dryRun: true });
    const live = await postStopSigned(signed, {
      timeoutMs: 10,
      fetchImpl: () => new Promise((_, rej) => {
        const e = new Error("aborted");
        e.name = "AbortError";
        setTimeout(() => rej(e), 1);
      }),
    });
    assert.equal(live.ok, false);
    assert.ok(live.code === "STOP_POST_TIMEOUT" || live.error === "timeout");
  });
});
