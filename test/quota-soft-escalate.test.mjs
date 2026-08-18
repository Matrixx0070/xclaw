import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shouldEscalateSoftToHard,
  escalateSoftResult,
} from "../src/security/quota-soft-escalate.mjs";

describe("quota soft→hard escalate", () => {
  it("does not escalate when not soft", () => {
    assert.equal(shouldEscalateSoftToHard({ ok: true, soft: false }), false);
  });

  it("escalates when hardOnSoft config", () => {
    assert.equal(
      shouldEscalateSoftToHard(
        { soft: true, ok: true, bytes: 1, quota: { maxBytes: 100 } },
        { workspace: { quota: { hardOnSoft: true } } }
      ),
      true
    );
  });

  it("escalates near hard via escalateSoftRatio", () => {
    assert.equal(
      shouldEscalateSoftToHard(
        {
          soft: true,
          ok: true,
          bytes: 99,
          quota: { maxBytes: 100, maxFiles: 1000 },
        },
        { workspace: { quota: { escalateSoftRatio: 0.98 } } }
      ),
      true
    );
  });

  it("escalateSoftResult marks hard refuse", () => {
    const r = escalateSoftResult({
      soft: true,
      ok: true,
      bytes: 90,
      files: 1,
      reasons: ["bytes soft"],
      quota: { maxBytes: 100 },
    });
    assert.equal(r.ok, false);
    assert.equal(r.hard, true);
    assert.equal(r.escalatedFromSoft, true);
    assert.equal(r.code, "WORKSPACE_QUOTA_SOFT_ESCALATED");
  });
});
