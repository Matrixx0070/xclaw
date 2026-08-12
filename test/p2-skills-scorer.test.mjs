import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultSkillRoots, loadAllSkills } from "../src/skills/loader.mjs";
import { scoreCase } from "../src/eval/scorer.mjs";

describe("config-driven skill roots (P2 7.4)", () => {
  it("cfg.skills.roots is honored and wins precedence (listed last)", async () => {
    const extra = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-skillroot-"));
    try {
      const roots = await defaultSkillRoots({ cfg: { skills: { roots: [extra] } } });
      assert.ok(roots.includes(extra), `cfg root missing: ${JSON.stringify(roots)}`);
      assert.equal(roots[roots.length - 1], extra, "operator root must be last (highest precedence)");
    } finally {
      await fs.rm(extra, { recursive: true, force: true });
    }
  });

  it("a cfg-rooted skill is actually loaded and overrides by name", async () => {
    const extra = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-skillroot2-"));
    const dir = path.join(extra, "p2-test-skill");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "SKILL.md"),
      "---\nname: p2-test-skill\ndescription: fixture skill for cfg.skills.roots\n---\n\n# p2 test skill\nbody\n"
    );
    try {
      const skills = await loadAllSkills({ cfg: { skills: { roots: [extra] } } });
      const hit = skills.find((s) => s.name?.toLowerCase() === "p2-test-skill");
      assert.ok(hit, "skill from cfg root not discovered");
    } finally {
      await fs.rm(extra, { recursive: true, force: true });
    }
  });

  it("legacy Grok-sandbox roots appear only when present on disk", async () => {
    const roots = await defaultSkillRoots({});
    for (const legacy of ["/root/.grok/skills", "/home/workdir/.grok/skills"]) {
      const onDisk = await fs.stat(legacy).then(() => true, () => false);
      assert.equal(
        roots.includes(legacy),
        onDisk,
        `${legacy}: in roots=${roots.includes(legacy)} but onDisk=${onDisk}`
      );
    }
  });

  it("default XClaw + bundled roots survive unchanged", async () => {
    const roots = await defaultSkillRoots({});
    assert.ok(roots.includes(path.join(os.homedir(), ".xclaw", "skills")));
    assert.ok(roots.some((r) => r.endsWith(path.join("skills", "bundled"))));
  });
});

describe("scorer normalized any-of matching (P2 0.9)", () => {
  async function mkWorkspace(fileRel, body) {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-score-"));
    const fp = path.join(ws, fileRel);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, body);
    return ws;
  }
  const baseResult = (ws) => ({ workspace: ws, verify: { ok: true, results: [] }, text: "" });

  it("accepts a reformatted correct answer (a+b, b + a)", async () => {
    for (const body of ["return a+b;", "return b + a;", "return a  +  b;"]) {
      const ws = await mkWorkspace("src/sum.js", body);
      try {
        const out = await scoreCase(
          { id: "t", expect: { fileContainsAny: [{ path: "src/sum.js", anyOf: ["a + b", "b + a"] }] } },
          baseResult(ws)
        );
        assert.equal(out.pass, true, `${JSON.stringify(body)} → ${out.failures}`);
      } finally {
        await fs.rm(ws, { recursive: true, force: true });
      }
    }
  });

  it("still rejects a wrong answer", async () => {
    const ws = await mkWorkspace("src/sum.js", "return a - b;");
    try {
      const out = await scoreCase(
        { id: "t", expect: { fileContainsAny: [{ path: "src/sum.js", anyOf: ["a + b", "b + a"] }] } },
        baseResult(ws)
      );
      assert.equal(out.pass, false);
      assert.ok(out.failures.some((f) => f.startsWith("fileContainsAny:")));
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("missing file fails, not crashes", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-score-"));
    try {
      const out = await scoreCase(
        { id: "t", expect: { fileContainsAny: [{ path: "nope.js", anyOf: ["x"] }] } },
        baseResult(ws)
      );
      assert.equal(out.pass, false);
      assert.ok(out.failures.includes("fileContainsAny:missing:nope.js"));
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("replyContainsAny matches normalized alternatives and rejects wrong replies", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-score-"));
    try {
      const caseDef = { id: "t", expect: { replyContainsAny: [["sum(2,3) === 5", "sum(2, 3) is 5"]] } };
      const ok = await scoreCase(caseDef, { ...baseResult(ws), text: "Verified: sum(2,3)===5 now." });
      assert.equal(ok.pass, true, String(ok.failures));
      const bad = await scoreCase(caseDef, { ...baseResult(ws), text: "It returns 6." });
      assert.equal(bad.pass, false);
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("hard.json still parses and keeps the semantic command checks", async () => {
    const raw = JSON.parse(await fs.readFile(new URL("../eval/cases/hard.json", import.meta.url), "utf8"));
    const sum = raw.find((c) => c.id === "hard-fix-sum");
    assert.ok(sum.expect.success.some((s) => s.type === "command" && s.exitCode === 0));
    assert.ok(sum.expect.fileContainsAny?.[0]?.anyOf?.length >= 2);
    const toggle = raw.find((c) => c.id === "hard-config-toggle");
    assert.ok(toggle.expect.success.some((s) => s.type === "command"));
  });
});
