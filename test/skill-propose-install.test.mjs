import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  proposeSkillFromFailure,
  installProposal,
  listProposals,
} from "../src/skills/propose.mjs";

describe("skill promotion", () => {
  it("propose and install", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-sk-"));
    const cfg = { paths: { configDir: dir } };
    const prop = await proposeSkillFromFailure(cfg, {
      caseId: "test-case",
      goal: "fix the thing",
      failures: ["verify:file_contains"],
      text: "I tried",
      toolTrace: [{ name: "bash", args: { command: "ls" } }],
    });
    assert.ok(prop.path);
    const list = await listProposals(cfg);
    assert.ok(list.length >= 1);
    const inst = await installProposal(cfg, prop.path, { force: true });
    assert.ok(inst.path.includes("SKILL.md"));
    const body = await fs.readFile(inst.path, "utf8");
    assert.ok(/enabled:\s*true/i.test(body));
  });
});
