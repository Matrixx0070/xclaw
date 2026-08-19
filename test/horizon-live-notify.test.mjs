import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  notifyLiveReport,
  liveNotifyBody,
  resetLiveNotifyMetrics,
  getLiveNotifyTotal,
  lastLiveNotify,
} from "../src/eval/horizon-live-notify.mjs";
import { doctorHorizon } from "../src/cli/doctor-horizon.mjs";

describe("live report notify", () => {
  it("ok=true does not POST", async () => {
    resetLiveNotifyMetrics();
    let called = 0;
    const r = await notifyLiveReport(
      { ok: true, ids: ["G10"], usedUsd: 0.1, turns: 2 },
      {
        webhook: "https://example.test/hook",
        fetch: async () => {
          called += 1;
          return { status: 200 };
        },
      }
    );
    assert.equal(r.skipped, true);
    assert.equal(r.reason, "ok_true");
    assert.equal(called, 0);
    assert.equal(getLiveNotifyTotal(), 0);
  });

  it("ok=false POSTs body without secrets", async () => {
    resetLiveNotifyMetrics();
    let payload = null;
    const r = await notifyLiveReport(
      { ok: false, ids: ["G10"], usedUsd: 1.2, turns: 5, at: "t" },
      {
        webhook: "https://example.test/hook",
        fetch: async (url, init) => {
          payload = { url, ...JSON.parse(init.body) };
          return { status: 204 };
        },
      }
    );
    assert.equal(r.ok, true);
    assert.equal(payload.ok, false);
    assert.ok(!JSON.stringify(payload).toLowerCase().includes("key"));
    assert.ok(getLiveNotifyTotal() >= 1);
    assert.equal(lastLiveNotify().ok, true);
    const body = liveNotifyBody({ ok: false, ids: ["G10"] });
    assert.equal(body.ok, false);
  });

  it("no webhook skips", async () => {
    const r = await notifyLiveReport({ ok: false }, { webhook: "" });
    assert.equal(r.skipped, true);
  });

  it("doctor exposes last notify", async () => {
    const d = await doctorHorizon({});
    assert.ok("lastLiveNotify" in d || d.lastLiveNotify === undefined);
  });
});
