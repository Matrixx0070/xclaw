import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emitQuotaSoftWarn, maybeEmitQuotaSoft } from "../src/security/quota-soft-warn.mjs";

describe("quota soft-warn", () => {
  it("broadcasts WS and publishes SSE", () => {
    const seen = [];
    const r = emitQuotaSoftWarn(
      { message: "bytes soft", room: "security" },
      {
        broadcast: (ch, ev) => {
          seen.push(["ws", ch, ev.phase]);
          return { ok: true };
        },
        publish: (room, ev) => {
          seen.push(["sse", room, ev]);
          return { ok: true };
        },
      }
    );
    assert.equal(r.event.phase, "soft");
    assert.deepEqual(seen, [
      ["ws", "security", "soft"],
      ["sse", "security", "quota_soft"],
    ]);
  });

  it("skips when not in soft band", () => {
    const r = maybeEmitQuotaSoft({ ok: true, soft: false });
    assert.equal(r.skipped, true);
  });
});
