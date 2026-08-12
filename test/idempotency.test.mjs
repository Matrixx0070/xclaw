import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  withIdempotency,
  beginIdempotent,
  completeIdempotent,
  requestFingerprint,
  idempotencyKeyFromEvent,
  IdempotencyError,
  clearIdempotencyStore,
} from "../src/auth/idempotency.mjs";

describe("idempotency keys", () => {
  async function tmpCfg(extra = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-idem-"));
    return {
      paths: { configDir: dir },
      auth: {
        idempotency: {
          ttlMs: 60_000,
          onInProgress: "reject",
          ...extra,
        },
      },
    };
  }

  it("runs once and replays result", async () => {
    const cfg = await tmpCfg();
    let n = 0;
    const a = await withIdempotency(cfg, "op-1", async () => {
      n++;
      return { ok: true, n };
    });
    const b = await withIdempotency(cfg, "op-1", async () => {
      n++;
      return { ok: true, n };
    });
    assert.equal(n, 1);
    assert.equal(a.n, 1);
    assert.equal(b.n, 1);
    assert.equal(b._replay, true);
  });

  it("rejects in-progress duplicate", async () => {
    const cfg = await tmpCfg();
    await beginIdempotent(cfg, "busy");
    await assert.rejects(
      () => beginIdempotent(cfg, "busy"),
      (e) => e instanceof IdempotencyError && e.code === "IN_PROGRESS"
    );
    await completeIdempotent(cfg, "busy", { ok: true });
  });

  it("fingerprint mismatch on reuse", async () => {
    const cfg = await tmpCfg();
    await withIdempotency(
      cfg,
      "fp-1",
      async () => ({ ok: true }),
      { request: { a: 1 } }
    );
    await assert.rejects(
      () =>
        withIdempotency(cfg, "fp-1", async () => ({ ok: true }), {
          request: { a: 2 },
        }),
      (e) => e.code === "FINGERPRINT_MISMATCH"
    );
  });

  it("idempotencyKeyFromEvent stable", () => {
    const k1 = idempotencyKeyFromEvent({
      type: "jwks_invalidation",
      epoch: 3,
      generation: 2,
    });
    const k2 = idempotencyKeyFromEvent({
      generation: 2,
      epoch: 3,
      type: "jwks_invalidation",
    });
    assert.equal(k1, k2);
    assert.ok(k1.startsWith("evt:"));
  });

  it("requestFingerprint order independent", () => {
    assert.equal(
      requestFingerprint({ b: 2, a: 1 }),
      requestFingerprint({ a: 1, b: 2 })
    );
  });

  it("clear store", async () => {
    const cfg = await tmpCfg();
    await withIdempotency(cfg, "x", async () => ({ ok: true }));
    await clearIdempotencyStore(cfg);
    let n = 0;
    await withIdempotency(cfg, "x", async () => {
      n++;
      return { ok: true };
    });
    assert.equal(n, 1);
  });
});
