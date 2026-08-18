/**
 * Mock smoke writes a durable baseline artifact.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runEvalSuite } from "../src/eval/runner.mjs";

describe("eval baseline mock artifact", () => {
  let tmp;
  after(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  });

  it("writes last-mock shaped report to disk", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-eval-base-"));
    const outPath = path.join(tmp, "last-mock.json");
    const report = await runEvalSuite({
      cfg: { security: { autoApprove: true }, agent: { maxTurns: 2 } },
      tag: "smoke",
      mock: true,
    });
    assert.ok(report.total >= 1);
    assert.ok(report.results.every((r) => r.mock === true));
    await fs.writeFile(outPath, JSON.stringify(report, null, 2));
    const raw = await fs.readFile(outPath, "utf8");
    const loaded = JSON.parse(raw);
    assert.equal(loaded.total, report.total);
    assert.ok(Array.isArray(loaded.results));
    assert.equal(typeof loaded.passRate, "number");
  });
});
