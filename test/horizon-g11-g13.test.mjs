import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCases } from "../src/eval/runner.mjs";
import { scoreCase } from "../src/eval/scorer.mjs";
import {
  syntheticG11Job,
  syntheticG13Job,
} from "../src/eval/horizon-offline.mjs";

describe("horizon G11 G13", () => {
  it("G11 recover synthetic passes", async () => {
    const cases = await loadCases({ id: "a4-G11-tool-fail-recover" });
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g11-"));
    const job = await syntheticG11Job(workspace);
    const scored = await scoreCase(cases[0], job);
    assert.equal(scored.pass, true, JSON.stringify(scored));
  });
  it("G13 grounded synthetic passes", async () => {
    const cases = await loadCases({ id: "a4-G13-canary-then-ground" });
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g13-"));
    const job = await syntheticG13Job(workspace);
    const scored = await scoreCase(cases[0], job);
    assert.equal(scored.pass, true, JSON.stringify(scored));
  });
});
