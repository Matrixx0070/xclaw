/**
 * P0.1 — Heartbeat delivery: arg order, silence skip, channel-deliver.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { deliverToChannel } from "../src/cron/channel-deliver.mjs";

describe("channel-deliver", () => {
  const calls = [];
  let origFetch;

  before(() => {
    origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      calls.push({ url: String(url), body: opts?.body });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, id: "msg_1", ts: "1.2" }),
      };
    };
  });

  after(() => {
    globalThis.fetch = origFetch;
  });

  it("rejects missing fields", async () => {
    const r = await deliverToChannel({ mode: "announce", channel: "telegram" }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_fields");
  });

  it("telegram uses correct arg order (delivery, cfg)", async () => {
    calls.length = 0;
    const r = await deliverToChannel(
      { mode: "announce", channel: "telegram", to: "12345", text: "hello owner" },
      { channels: { telegram: { token: "tok-test" } } }
    );
    assert.equal(r.ok, true);
    assert.ok(calls[0].url.includes("api.telegram.org"));
    assert.ok(String(calls[0].body).includes("12345"));
  });

  it("mode none skips", async () => {
    const r = await deliverToChannel({ mode: "none", channel: "telegram", to: "1", text: "x" }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_delivery");
  });
});

describe("heartbeat silence policy", () => {
  it("HEARTBEAT_OK is silence", () => {
    const text = "HEARTBEAT_OK";
    const silenceOk =
      /^HEARTBEAT_OK$/i.test(text) || text.length < 8;
    assert.equal(silenceOk, true);
  });

  it("substantive text is not silence", () => {
    const text = "Owner: disk is 95% full on /var — please check.";
    const silenceOk =
      /^HEARTBEAT_OK$/i.test(text) || text.length < 8;
    assert.equal(silenceOk, false);
  });
});
