import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emitQuotaSoftWarn } from "../src/security/quota-soft-warn.mjs";
import { createMockSSEResponse, createSSEFanout } from "../src/gateway/sse-fanout.mjs";
import { setSSEFanout, getSSEFanout } from "../src/gateway/sse-fanout-registry.mjs";

describe("quota soft-warn real hubs", () => {
  it("uses __xclawWsBroadcast when no hub inject", () => {
    const seen = [];
    globalThis.__xclawWsBroadcast = (ch, ev) => {
      seen.push([ch, ev.phase]);
      return { ok: true };
    };
    const r = emitQuotaSoftWarn(
      { message: "bytes soft" },
      { publish: () => ({ ok: true }) }
    );
    assert.deepEqual(seen, [["security", "soft"]]);
    assert.equal(r.ws.ok, true);
    delete globalThis.__xclawWsBroadcast;
  });

  it("publishes onto the live SSE registry", async () => {
    const hub = createSSEFanout();
    setSSEFanout(hub);
    const res = createMockSSEResponse();
    hub.subscribe(res, "security");
    const r = emitQuotaSoftWarn({ message: "files soft" });
    await r.sse;
    assert.ok(getSSEFanout().stats().subscribers >= 1);
  });
});
