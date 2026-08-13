import { describe, it } from "node:test";
import assert from "node:assert/strict";

// POST /media/jobs regressions found by clicking Generate in the control UI:
//  1. the handler didn't await the async enqueueMediaJob, so every caller got
//     a serialized pending Promise — literally "{}" — while the job ran blind;
//  2. credential resolution only looked at env vars, not the provider
//     credential store the rest of xclaw uses.
import { tryHandleMediaRoute } from "../src/gateway/routes/media.mjs";

function call(p, method, body, cfg = {}) {
  let out = null, status = null;
  return tryHandleMediaRoute({
    p, method,
    req: { headers: {}, url: p },
    res: {},
    cfg,
    json: (_r, c, payload) => { status = c; out = payload; },
    readBody: async () => body || {},
  }).then((handled) => ({ handled, status, out }));
}

describe("POST /media/jobs", () => {
  it("returns the RESOLVED job (not '{}' from an unawaited promise)", async () => {
    const { handled, status, out } = await call("/media/jobs", "POST", {
      type: "image",
      prompt: "", // no prompt → deterministic error job, no network
    });
    assert.equal(handled, true);
    assert.equal(status, 200);
    // A pending Promise JSON-serializes to {} — the resolved job must carry
    // its real fields.
    assert.ok(out.id, "job id present");
    assert.equal(out.status, "error");
    assert.match(out.error, /prompt required/);
  });

  it("unsupported type resolves too", async () => {
    const { out } = await call("/media/jobs", "POST", { type: "video", prompt: "x" });
    assert.equal(out.status, "unsupported");
    assert.ok(out.id);
  });
});
