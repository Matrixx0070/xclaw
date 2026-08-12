import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { proposeSkillFromSuccess } from "../src/skills/propose.mjs";
import {
  extractPreferenceHints,
  writePreferences,
  loadPreferences,
} from "../src/memory/preferences.mjs";

describe("R5 learning light", () => {
  it("proposeSkillFromSuccess writes draft", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-r5-"));
    const cfg = {
      paths: { configDir: dir },
      skills: { proposeOnSuccess: true, proposeOnSuccessMinTools: 2 },
    };
    const out = await proposeSkillFromSuccess(cfg, {
      caseId: "demo",
      goal: "organize downloads",
      text: "Moved 3 pdfs into pdfs/",
      toolTrace: [
        { name: "bash", args: { command: "ls" } },
        { name: "bash", args: { command: "mkdir pdfs" } },
      ],
    });
    assert.equal(out.ok, true);
    const body = await fs.readFile(out.path, "utf8");
    assert.match(body, /REVIEW REQUIRED/);
    assert.match(body, /organize downloads/);
  });

  it("skips when too few tools", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-r5b-"));
    const out = await proposeSkillFromSuccess(
      { paths: { configDir: dir }, skills: { proposeOnSuccessMinTools: 2 } },
      { goal: "x", toolTrace: [{ name: "bash" }] }
    );
    assert.equal(out.ok, false);
  });

  it("preference extract + write-back", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-r5c-"));
    const cfg = { paths: { configDir: dir }, memory: { preferenceWriteBack: true } };
    const hints = extractPreferenceHints(
      "Prefer markdown for notes.\nAlways confirm before deleting.\nhello"
    );
    assert.ok(hints.length >= 2);
    const w = await writePreferences(cfg, hints, { source: "test" });
    assert.ok(w.written >= 1);
    const again = await writePreferences(cfg, hints, { source: "test" });
    assert.equal(again.written, 0);
    const body = await loadPreferences(cfg);
    assert.match(body, /Prefer markdown/);
  });
});
