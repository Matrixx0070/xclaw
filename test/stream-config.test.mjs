import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/config/defaults.mjs";
import { validateConfig } from "../src/config/validate.mjs";
import { resolveStreamOptsFromConfig } from "../src/gateway/stream-resume.mjs";

describe("stream config knobs", () => {
  it("DEFAULT_CONFIG.stream has expected keys", () => {
    const s = DEFAULT_CONFIG.stream;
    assert.ok(s);
    assert.equal(s.capacity, 500);
    assert.equal(s.ttlMs, 300_000);
    assert.equal(s.heartbeatMs, 15_000);
    assert.equal(s.backoff, "full");
    assert.equal(s.baseMs, 1000);
    assert.equal(s.maxMs, 30_000);
  });

  it("resolveStreamOptsFromConfig uses cfg", () => {
    const o = resolveStreamOptsFromConfig({
      stream: { capacity: 10, ttlMs: 1000, heartbeatMs: 0, backoff: "decorrelated" },
    });
    assert.equal(o.capacity, 10);
    assert.equal(o.ttlMs, 1000);
    assert.equal(o.heartbeatMs, 0);
    assert.equal(o.backoff, "decorrelated");
  });

  it("validate rejects bad capacity", () => {
    const r = validateConfig({
      ...DEFAULT_CONFIG,
      stream: { ...DEFAULT_CONFIG.stream, capacity: -1 },
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /capacity/.test(e)));
    assert.ok(r.details?.some((d) => d.code === "STREAM_CAPACITY_RANGE"));
    assert.ok(r.details?.some((d) => /Ring buffer/.test(d.hint || "")));
  });

  it("validate details for maxMs < baseMs", () => {
    const r = validateConfig({
      ...DEFAULT_CONFIG,
      stream: { ...DEFAULT_CONFIG.stream, baseMs: 5000, maxMs: 100 },
    });
    assert.equal(r.ok, false);
    const d = r.details?.find((x) => x.code === "STREAM_BACKOFF_RANGE");
    assert.ok(d);
    assert.equal(d.got.baseMs, 5000);
  });

  it("validate normalizes backoff", () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      stream: { ...DEFAULT_CONFIG.stream, backoff: "full_jitter" },
    };
    const r = validateConfig(cfg);
    assert.equal(r.ok, true);
    assert.equal(cfg.stream.backoff, "full");
  });
});
