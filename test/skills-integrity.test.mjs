import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadAllSkills } from "../src/skills/loader.mjs";
import {
  LOCKFILE_NAME,
  buildLockData,
  writeLockfile,
  readLockfile,
  evaluateSkills,
  resolveIntegrityMode,
  _resetWarnedForTests,
} from "../src/skills/integrity.mjs";
import { createSkillTools } from "../src/tools/skill-tools.mjs";

/** Isolated workspace: .git marker (lockfile anchor) + one skills root. */
async function makeWorkspace(skillDefs) {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-integ-"));
  await fs.mkdir(path.join(ws, ".git"));
  const root = path.join(ws, "skills");
  for (const [name, body] of Object.entries(skillDefs)) {
    const dir = path.join(root, name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: test skill ${name}\n---\n${body}\n`
    );
  }
  // cfg confined to this workspace only (no host/global/bundled roots):
  // configDir points inside ws; bundled roots still join, so deny-filter to ours.
  const cfg = (extra = {}) => ({
    paths: { configDir: path.join(ws, ".xclaw") },
    skills: {
      roots: [root],
      allow: Object.keys(skillDefs),
      ...extra,
    },
  });
  return { ws, root, cfg };
}

describe("skills integrity manifest", () => {
  it("lock data matches discovered skills and verify detects a body edit", async () => {
    const { ws, root, cfg } = await makeWorkspace({ alpha: "do alpha", beta: "do beta" });
    try {
      const skills = await loadAllSkills({ cwd: ws, cfg: cfg() });
      const data = await buildLockData(skills);
      assert.deepEqual(Object.keys(data.skills).sort(), ["alpha", "beta"]);
      await writeLockfile(ws, data);
      const { data: read } = await readLockfile(ws);
      assert.ok(read);

      // untouched → all verified
      let r = await evaluateSkills(skills, read);
      assert.ok(r.evaluated.every((e) => e.status === "verified"));
      assert.equal(r.missing.length, 0);

      // edit a body → changed
      await fs.appendFile(path.join(root, "alpha", "SKILL.md"), "\nEXTRA LINE\n");
      r = await evaluateSkills(skills, read);
      assert.equal(r.evaluated.find((e) => e.skill.name === "alpha").status, "changed");
      assert.equal(r.evaluated.find((e) => e.skill.name === "beta").status, "verified");
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("mode matrix: off without lockfile, warn with, prod enforces either way, explicit wins", () => {
    assert.equal(resolveIntegrityMode({}, false), "off");
    assert.equal(resolveIntegrityMode({}, true), "warn");
    assert.equal(resolveIntegrityMode({ profile: "prod" }, true), "enforce");
    // prod fails closed: no lockfile means refuse unpinned skill injection
    assert.equal(resolveIntegrityMode({ profile: "prod" }, false), "enforce");
    assert.equal(resolveIntegrityMode({ skills: { integrity: "enforce" } }, false), "enforce");
    assert.equal(resolveIntegrityMode({ profile: "prod", skills: { integrity: "off" } }, true), "off");
  });

  it("warn mode loads drifted skills but flags them", async () => {
    _resetWarnedForTests();
    const { ws, root, cfg } = await makeWorkspace({ alpha: "do alpha", beta: "do beta" });
    try {
      const skills = await loadAllSkills({ cwd: ws, cfg: cfg() });
      await writeLockfile(ws, await buildLockData(skills));
      await fs.appendFile(path.join(root, "alpha", "SKILL.md"), "\nDRIFT\n");
      const loaded = await loadAllSkills({ cwd: ws, cfg: cfg({ integrity: "warn" }) });
      const names = loaded.map((s) => s.name).sort();
      assert.deepEqual(names, ["alpha", "beta"]);
      assert.equal(loaded.find((s) => s.name === "alpha").integrity, "changed");
      assert.equal(loaded.find((s) => s.name === "beta").integrity, "verified");
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("enforce mode excludes changed and unmanifested, keeps verified", async () => {
    _resetWarnedForTests();
    const { ws, root, cfg } = await makeWorkspace({ alpha: "do alpha", beta: "do beta" });
    try {
      const skills = await loadAllSkills({ cwd: ws, cfg: cfg() });
      await writeLockfile(ws, await buildLockData(skills));
      // drift alpha; add an unmanifested gamma
      await fs.appendFile(path.join(root, "alpha", "SKILL.md"), "\nDRIFT\n");
      const gdir = path.join(root, "gamma");
      await fs.mkdir(gdir, { recursive: true });
      await fs.writeFile(path.join(gdir, "SKILL.md"), "---\nname: gamma\n---\nnew skill\n");
      const loaded = await loadAllSkills({
        cwd: ws,
        cfg: {
          paths: { configDir: path.join(ws, ".xclaw") },
          skills: { roots: [root], allow: ["alpha", "beta", "gamma"], integrity: "enforce" },
        },
      });
      assert.deepEqual(loaded.map((s) => s.name), ["beta"]);
      assert.equal(loaded.find((s) => s.name === "beta").integrity, "verified");
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("xclaw_skill tool respects enforce exclusion", async () => {
    _resetWarnedForTests();
    const { ws, root, cfg } = await makeWorkspace({ alpha: "secret drifted body", beta: "do beta" });
    try {
      const skills = await loadAllSkills({ cwd: ws, cfg: cfg() });
      await writeLockfile(ws, await buildLockData(skills));
      await fs.appendFile(path.join(root, "alpha", "SKILL.md"), "\nDRIFT\n");
      const [tool] = createSkillTools({
        workingDir: ws,
        cfg: {
          paths: { configDir: path.join(ws, ".xclaw") },
          skills: { roots: [root], allow: ["alpha", "beta"], integrity: "enforce" },
        },
      });
      const byName = await tool.execute({ name: "alpha" });
      assert.equal(byName.isError, true, "drifted skill must not be loadable in enforce mode");
      const list = await tool.execute({});
      assert.ok(!list.content[0].text.includes("alpha"), "excluded skill absent from list");
      assert.ok(list.content[0].text.includes("beta"));
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("missing manifested skill is reported by evaluateSkills", async () => {
    const { ws, root, cfg } = await makeWorkspace({ alpha: "a", beta: "b" });
    try {
      const skills = await loadAllSkills({ cwd: ws, cfg: cfg() });
      const lock = await buildLockData(skills);
      await writeLockfile(ws, lock);
      await fs.rm(path.join(root, "beta"), { recursive: true });
      const after = await loadAllSkills({ cwd: ws, cfg: cfg({ integrity: "off" }) });
      const { missing } = await evaluateSkills(after, lock);
      assert.deepEqual(missing, ["beta"]);
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });
});
