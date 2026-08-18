import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStopSignResult, postStopSigned, stopSignMain } from "../src/cli/stop-sign.mjs";

describe("stop --sign --post", () => {
  it("postStopSigned records dryRun from mock fetch", async () => {
    const signed = buildStopSignResult(
      { gateway: { token: "t", host: "127.0.0.1", port: 18790 } },
      { dryRun: true }
    );
    const live = await postStopSigned(signed, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            dryRun: true,
            authMethod: "token",
            killedSessions: [],
          });
        },
      }),
    });
    assert.equal(live.ok, true);
    assert.equal(live.dryRun, true);
    assert.equal(live.authMethod, "token");
  });

  it("stopSignMain --post attaches post result", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ ok: true, dryRun: true, authMethod: "lab", killedSessions: [] });
      },
    });
    try {
      const r = await stopSignMain(["--dry-run", "--post", "--json"], async () => ({
        gateway: { token: "tok" },
      }));
      assert.equal(r.post?.ok, true);
      assert.equal(r.post?.dryRun, true);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
