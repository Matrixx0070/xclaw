import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runVerifyChecks } from "../src/jobs/verify.mjs";

describe("verify caseInsensitive", () => {
  it("matches Auth with text auth", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-ci-"));
    await fs.writeFile(path.join(dir, "memo.md"), "## Risks\nAuth token rotation\n");
    const r = await runVerifyChecks(dir, [
      { type: "file_contains", path: "memo.md", text: "auth", caseInsensitive: true },
    ]);
    assert.equal(r.ok, true);
  });
  it("regex with flags i", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-ci-"));
    await fs.writeFile(path.join(dir, "memo.md"), "Latency is 200ms\n");
    const r = await runVerifyChecks(dir, [
      { type: "file_contains", path: "memo.md", regex: "latency", flags: "i" },
    ]);
    assert.equal(r.ok, true);
  });
});
