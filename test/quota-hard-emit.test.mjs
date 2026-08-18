import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emitQuotaHard, maybeEmitQuotaHard } from "../src/security/quota-soft-warn.mjs";

describe("quota hard emit", () => {
  it("broadcasts hard phase on WS and SSE", () => {
    const seen = [];
    const r = emitQuotaHard(
      { message: "bytes hard", room: "security" },
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
    assert.equal(r.event.phase, "hard");
    assert.deepEqual(seen, [
      ["ws", "security", "hard"],
      ["sse", "security", "quota_hard"],
    ]);
  });

  it("maybeEmitQuotaHard skips when ok", () => {
    const r = maybeEmitQuotaHard({ ok: true, soft: false });
    assert.equal(r.skipped, true);
  });

  it("maybeEmitQuotaHard fires when not ok", () => {
    const r = maybeEmitQuotaHard(
      { ok: false, hard: true, code: "WORKSPACE_QUOTA_EXCEEDED" },
      {},
      { publish: () => ({ ok: true }), broadcast: () => ({ ok: true }) }
    );
    assert.equal(r.skipped, false);
    assert.equal(r.event.phase, "hard");
  });
});
