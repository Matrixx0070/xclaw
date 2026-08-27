/**
 * RULE(n) sweep #64 — the Telegram 4096 hard ceiling on operator
 * chunkMax config. Dropping the clamp left the FULL suite green
 * (3860/0): a config `chunkMax: 8000` would send over-limit bodies and
 * Telegram would 400 every long reply live. The computation now lives
 * in pure `resolveChunkLimits` (behaviorally pinned here) and the
 * channel factory is source-pinned onto it so the pure function IS the
 * live line.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { resolveChunkLimits } from "../src/channels/telegram/chunk-text.mjs";

describe("telegram chunk limits (sweep #64)", () => {
  it("defaults: 4000 chunk, 12000 total", () => {
    assert.deepEqual(resolveChunkLimits({}), { chunkMax: 4000, maxReplyChars: 12_000 });
    assert.deepEqual(resolveChunkLimits(), { chunkMax: 4000, maxReplyChars: 12_000 });
  });

  it("operator chunkMax above Telegram's hard limit clamps to 4096", () => {
    assert.equal(resolveChunkLimits({ chunkMax: 8000 }).chunkMax, 4096);
    assert.equal(resolveChunkLimits({ maxChunkChars: 999999 }).chunkMax, 4096);
    assert.equal(resolveChunkLimits({ chunkMax: 3000 }).chunkMax, 3000);
    assert.equal(resolveChunkLimits({ chunkMax: 4096 }).chunkMax, 4096);
  });

  it("maxReplyChars never floors below chunkMax", () => {
    const r = resolveChunkLimits({ chunkMax: 8000, maxReplyChars: 100 });
    assert.equal(r.chunkMax, 4096);
    assert.equal(r.maxReplyChars, 4096);
    assert.equal(resolveChunkLimits({ maxReplyChars: 20_000 }).maxReplyChars, 20_000);
  });

  it("the channel factory computes its limits through resolveChunkLimits (live wire pin)", () => {
    const src = fs.readFileSync(new URL("../src/channels/telegram/index.mjs", import.meta.url), "utf8");
    assert.match(src, /const \{ chunkMax, maxReplyChars \} = resolveChunkLimits\(conf\);/);
    assert.doesNotMatch(src, /Math\.min\(4096/, "no inline duplicate of the clamp");
  });
});
