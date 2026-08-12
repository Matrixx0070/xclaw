
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { seedMultiNightSoak, getSoakSummary } from "../src/eval/soak.mjs";

describe("multi-night soak", () => {
  it("seeds 3 nights", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-mn-"));
    const cfg = { paths: { configDir: dir } };
    const out = await seedMultiNightSoak(cfg, 3);
    assert.equal(out.nights, 3);
    const s = await getSoakSummary(cfg);
    assert.ok(s.nights >= 3);
    assert.equal(s.gate.nightsOk, true);
  });
});
