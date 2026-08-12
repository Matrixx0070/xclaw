import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildContextSections, loadAllSkills } from "../src/skills/loader.mjs";
import { createSkillTools } from "../src/tools/skill-tools.mjs";

const BIG_BODY = "BIG SKILL LINE lorem ipsum dolor sit amet.\n".repeat(80); // ~3.4KB
const SMALL_BODY = "Small skill: do the small thing carefully.";

let root;
let cfg;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-skillprog-"));
  const mk = async (name, description, body, extra = "") => {
    const dir = path.join(root, name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n${extra}---\n${body}\n`
    );
  };
  await mk("bigskill", "a very large skill", BIG_BODY, "triggers: [deploy, release]\n");
  await mk("smallskill", "a tiny skill", SMALL_BODY);
  cfg = { skills: { roots: [root], allow: ["bigskill", "smallskill"] } };
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("skills progressive disclosure (7.3)", () => {
  it("progressive mode: index for all, full inline only for small skills", async () => {
    const skills = await loadAllSkills({ cwd: root, cfg });
    assert.equal(skills.length, 2);
    const text = buildContextSections({ skills });
    // Index lists both, with tool guidance and size hint for the big one
    assert.match(text, /Available skills/);
    assert.match(text, /xclaw_skill/);
    assert.match(text, /bigskill.*a very large skill/);
    assert.match(text, /triggers: deploy, release/);
    assert.match(text, /load with xclaw_skill/);
    // Small skill inlined in FULL; big skill body absent entirely (no mid-cut)
    assert.ok(text.includes(SMALL_BODY), "small skill inlined whole");
    assert.ok(!text.includes("BIG SKILL LINE"), "big skill body not inlined");
  });

  it("never truncates a body mid-skill (whole-body or nothing)", async () => {
    const skills = await loadAllSkills({ cwd: root, cfg });
    // inlineMax admits both, but budget only fits the small body whole:
    // small inlines in FULL, big is absent entirely — never a partial body.
    const text = buildContextSections({ skills, inlineMaxChars: 10_000, maxSkillChars: 100 });
    assert.ok(text.includes(SMALL_BODY), "small body fits budget → inlined whole");
    assert.ok(!text.includes("BIG SKILL LINE"), "big body exceeds budget → absent, not cut");
    // And with a budget below even the small body, nothing is inlined at all
    const tiny = buildContextSections({ skills, inlineMaxChars: 10_000, maxSkillChars: 20 });
    assert.ok(!tiny.includes(SMALL_BODY));
    assert.ok(!tiny.includes("BIG SKILL LINE"));
    assert.match(tiny, /Available skills/);
  });

  it("cfg.skills.progressive:false restores legacy truncating behavior", async () => {
    const legacyCfg = { skills: { ...cfg.skills, progressive: false } };
    const skills = await loadAllSkills({ cwd: root, cfg: legacyCfg });
    const text = buildContextSections({ skills, maxSkillChars: 500 });
    // Legacy inlines (truncated) — big skill's body appears cut into the budget
    assert.match(text, /Skill details/);
    assert.ok(text.includes("BIG SKILL LINE"), "legacy mode inlines big skill (truncated)");
  });

  it("explicit opts override the array markers", async () => {
    const skills = await loadAllSkills({ cwd: root, cfg });
    const text = buildContextSections({ skills, progressive: false, maxSkillChars: 300 });
    assert.ok(text.includes("BIG SKILL LINE"));
  });
});

describe("xclaw_skill tool", () => {
  it("returns full body by name (case-insensitive)", async () => {
    const [tool] = createSkillTools({ workingDir: root, cfg });
    assert.equal(tool.name, "xclaw_skill");
    const r = await tool.execute({ name: "BigSkill" });
    assert.ok(!r.isError);
    assert.ok(r.content[0].text.includes("BIG SKILL LINE"), "full body returned");
    assert.equal(r.skill.name, "bigskill");
  });

  it("lists skills when called without name", async () => {
    const [tool] = createSkillTools({ workingDir: root, cfg });
    const r = await tool.execute({});
    assert.ok(!r.isError);
    assert.match(r.content[0].text, /bigskill/);
    assert.match(r.content[0].text, /smallskill/);
    assert.equal(r.count, 2);
  });

  it("unknown name → structured error listing available skills", async () => {
    const [tool] = createSkillTools({ workingDir: root, cfg });
    const r = await tool.execute({ name: "nope" });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Unknown skill "nope"/);
    assert.match(r.content[0].text, /bigskill/);
  });

  it("dispatches through the Tool Router on the local plane", async () => {
    const { createToolRouter } = await import("../src/tools/router.mjs");
    const localTools = createSkillTools({ workingDir: root, cfg });
    const router = createToolRouter({ computer: null, localTools });
    const r = await router.dispatch({ name: "xclaw_skill", args: { name: "smallskill" } });
    assert.equal(r.ok, true);
    assert.equal(r.plane, "local");
    const text = JSON.stringify(r.result ?? r);
    assert.ok(text.includes("small thing"), `router result carries body: ${text.slice(0, 200)}`);
  });

  it("is registered in the aggregate local tool list", async () => {
    const { createAllLocalTools } = await import("../src/tools/registry.mjs");
    const names = createAllLocalTools({ workingDir: root, cfg }).map((t) => t.name);
    assert.ok(names.includes("xclaw_skill"), `xclaw_skill in ${names.length} local tools`);
  });
});
