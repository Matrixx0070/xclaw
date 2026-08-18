/**
 * Provider live-check circuit: 401 fails closed; hung fetch respects timeout.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("provider liveCheck circuit", () => {
  it("401 response is not ok", async () => {
    const { fetchLiveModels } = await import("../src/providers/discovery.mjs");
    const prev = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
      text: async () => "unauthorized",
    });
    try {
      const live = await fetchLiveModels(
        { agent: { apiKey: "bad", provider: "xai" } },
        "xai",
        { force: true, timeoutMs: 2000 }
      );
      assert.equal(live.ok, false);
      assert.ok(
        /401|unauth|fail|error/i.test(String(live.error || "")),
        JSON.stringify(live)
      );
    } finally {
      global.fetch = prev;
    }
  });

  it("hung fetch fails within timeoutMs budget", async () => {
    const { fetchLiveModels } = await import("../src/providers/discovery.mjs");
    const prev = global.fetch;
    global.fetch = async (_url, init) => {
      return new Promise((_resolve, reject) => {
        const t = setTimeout(() => reject(new Error("hang-should-have-aborted")), 30_000);
        if (init?.signal) {
          init.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(t);
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            },
            { once: true }
          );
        }
      });
    };
    try {
      const t0 = Date.now();
      const live = await fetchLiveModels(
        { agent: { apiKey: "x", provider: "xai" } },
        "xai",
        { force: true, timeoutMs: 150 }
      );
      const elapsed = Date.now() - t0;
      assert.equal(live.ok, false);
      assert.ok(elapsed < 2000, `hung ${elapsed}ms — must not wait forever`);
    } finally {
      global.fetch = prev;
    }
  });
});
