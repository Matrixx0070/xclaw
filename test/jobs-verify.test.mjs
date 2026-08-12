/**
 * H0/H1 unit tests — verify + evidence (no live model)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runVerifyChecks } from "../src/jobs/verify.mjs";
import { createEvidenceLog, flagUngroundedClaims } from "../src/jobs/evidence.mjs";
import { scoreCase } from "../src/eval/scorer.mjs";

describe("runVerifyChecks", () => {
  it("file_exists and file_contains", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-v-"));
    await fs.writeFile(path.join(dir, "README.md"), "# Eval Project\n");
    const r = await runVerifyChecks(dir, [
      { type: "file_exists", path: "README.md" },
      { type: "file_contains", path: "README.md", text: "# Eval Project" },
    ]);
    assert.equal(r.ok, true);
  });

  it("command check", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-v-"));
    await fs.writeFile(path.join(dir, "run.sh"), "#!/bin/bash\necho OK\nexit 0\n");
    const r = await runVerifyChecks(dir, [
      { type: "command", cmd: "bash run.sh", exitCode: 0 },
    ]);
    assert.equal(r.ok, true);
  });

  it("file_not_exists", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-v-"));
    const r = await runVerifyChecks(dir, [{ type: "file_not_exists", path: "nope.md" }]);
    assert.equal(r.ok, true);
  });
});

describe("evidence", () => {
  it("records tool evidence", () => {
    const log = createEvidenceLog();
    log.add({ source: "tool", summary: "bash → ok" });
    assert.equal(log.snapshot().length, 1);
  });
  it("flags ungrounded claims", () => {
    const w = flagUngroundedClaims("I created the file now", []);
    assert.ok(w.length >= 1);
  });
});

describe("scoreCase budgets", () => {
  it("fails over maxTurns budget", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-s-"));
    await fs.writeFile(path.join(dir, "README.md"), "# Eval Project\n");
    const caseDef = {
      id: "t",
      expect: {
        success: [{ type: "file_exists", path: "README.md" }],
        budgets: { maxTurns: 2 },
      },
    };
    const job = {
      workspace: dir,
      turns: 5,
      toolCalls: 1,
      toolErrors: 0,
      wallMs: 10,
      status: "succeeded",
      events: [],
      verify: await runVerifyChecks(dir, caseDef.expect.success),
    };
    const scored = await scoreCase(caseDef, job);
    assert.equal(scored.pass, false);
    assert.ok(scored.failures.some((f) => f.includes("maxTurns")));
  });
});
