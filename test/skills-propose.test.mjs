import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { proposeSkillFromFailure, listProposals } from "../src/skills/propose.mjs";

describe("skill propose", () => {
  it("writes a review-required draft", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-prop-"));
    const cfg = { paths: { configDir: dir } };
    const prop = await proposeSkillFromFailure(cfg, {
      caseId: "fs-write-readme",
      goal: "create readme",
      failures: ["verify:file_exists:README.md"],
      text: "I created it",
      toolTrace: [{ name: "xclaw_bash", args: { command: "ls" } }],
    });
    assert.ok(prop.path);
    const body = await fs.readFile(prop.path, "utf8");
    assert.ok(body.includes("REVIEW REQUIRED"));
    assert.ok(body.includes("enabled: false"));
    const list = await listProposals(cfg);
    assert.ok(list.length >= 1);
  });
});
