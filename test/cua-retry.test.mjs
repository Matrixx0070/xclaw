import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  withCuaRetry,
  backoffMs,
  isTransientCuaFailure,
  CUA_TRANSIENT_CODES,
} from "../src/computer/cua-retry.mjs";
import { runComputerAct } from "../src/computer/modules/computer-act-tool.mjs";

describe("CUA retry", () => {
  it("transient set includes CDP_ATTACH_FAILED", () => {
    assert.ok(CUA_TRANSIENT_CODES.has("CDP_ATTACH_FAILED"));
    assert.ok(isTransientCuaFailure("CDP_ATTACH_FAILED"));
    assert.equal(isTransientCuaFailure("DESKTOP_GUI_DISABLED"), false);
  });

  it("backoff grows", () => {
    const a = backoffMs(0, { baseMs: 100, maxMs: 10000, factor: 2, jitter: 0 });
    const b = backoffMs(2, { baseMs: 100, maxMs: 10000, factor: 2, jitter: 0 });
    assert.equal(a, 100);
    assert.equal(b, 400);
  });

  it("retries transient ok:false then succeeds", async () => {
    let n = 0;
    const r = await withCuaRetry(
      async () => {
        n += 1;
        if (n < 3) return { ok: false, code: "CDP_ATTACH_FAILED", error: "blip" };
        return { ok: true, value: 1 };
      },
      { retries: 3, baseMs: 1, maxMs: 5, jitter: 0 }
    );
    assert.equal(r.ok, true);
    assert.equal(n, 3);
    assert.ok(r.retried);
  });

  it("does not retry permanent codes", async () => {
    let n = 0;
    const r = await withCuaRetry(
      async () => {
        n += 1;
        return { ok: false, code: "DESKTOP_GUI_DISABLED", error: "off" };
      },
      { retries: 3, baseMs: 1, maxMs: 5, jitter: 0 }
    );
    assert.equal(r.ok, false);
    assert.equal(n, 1);
  });

  it("permanent computer_act still fast-fails", async () => {
    delete process.env.XCLAW_CDP_URL;
    delete process.env.CDP_URL;
    const t0 = Date.now();
    const r = await runComputerAct({ action: "click", x: 1, y: 1 });
    assert.equal(r.code, "CUA_ACT_REQUIRES_BUNDLE");
    assert.ok(Date.now() - t0 < 500, "should not backoff on permanent error");
  });
});
