import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  emitQuotaHard,
  maybeEmitQuotaHard,
  normalizeQuotaPayload,
} from "../src/security/quota-soft-warn.mjs";

describe("quota hard payload schema", () => {
  it("normalize always has tool and root", () => {
    const n = normalizeQuotaPayload({ message: "x" });
    assert.equal(n.tool, null);
    assert.equal(n.root, null);
  });

  it("emitQuotaHard includes tool+root even when omitted", () => {
    const r = emitQuotaHard(
      { message: "hard" },
      { broadcast: () => ({ ok: true }), publish: () => ({ ok: true }) }
    );
    assert.equal(r.event.phase, "hard");
    assert.ok("tool" in r.event);
    assert.ok("root" in r.event);
    assert.equal(r.event.tool, null);
    assert.equal(r.event.root, null);
  });

  it("maybeEmitQuotaHard preserves tool and root from extra", () => {
    const r = maybeEmitQuotaHard(
      { ok: false, hard: true, code: "WORKSPACE_QUOTA_EXCEEDED" },
      { tool: "file_write", root: "/tmp/ws" },
      { broadcast: () => ({ ok: true }), publish: () => ({ ok: true }) }
    );
    assert.equal(r.event.tool, "file_write");
    assert.equal(r.event.root, "/tmp/ws");
  });
});
