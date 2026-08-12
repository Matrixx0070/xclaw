/**
 * Skills + memory loader for XClaw Phase 5
 *
 * - SKILL.md under ~/.xclaw/skills, project .xclaw/skills, skills/bundled
 * - Grok sandbox pre-built skills: ~/.grok/skills, /root/.grok/skills
 * - Extra roots via XCLAW_GROK_SKILLS / GROK_SKILLS_PATH
 * - XCLAW.md / AGENTS.md walked upward from working directory
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadSkillStats, attachSkillStats } from "./registry.mjs";

/**
 * Parse optional YAML-ish front matter between --- lines.
 * Returns { meta, body }.
 */
/**
 * Parse YAML-ish front matter (OpenClaw SKILL.md compatible subset).
 * Supports: strings, numbers, booleans, inline [lists], user-invocable flags.
 */
export function parseFrontMatter(raw) {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) {
    return { meta: {}, body: text.trim() };
  }
  const end = text.indexOf("\n---", 3);
  if (end < 0) {
    return { meta: {}, body: text.trim() };
  }
  const fm = text.slice(3, end).trim();
  const body = text.slice(end + 4).trim();
  const meta = {};
  for (const line of fm.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    } else if (v === "true" || v === "yes") {
      v = true;
    } else if (v === "false" || v === "no") {
      v = false;
    } else if (/^-?\d+(\.\d+)?$/.test(v)) {
      v = Number(v);
    } else if (v.startsWith("[") && v.endsWith("]")) {
      v = v
        .slice(1, -1)
        .split(",")
        .map((x) => x.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
    meta[key] = v;
  }
  return { meta, body };
}

/** True when skill should be injected into agent context. */
export function isSkillEnabled(skill, cfg = {}) {
  if (!skill) return false;
  if (skill.meta?.enabled === false || skill.meta?.disable === true) return false;
  if (skill.meta?.["user-invocable"] === false && cfg.skills?.requireUserInvocable) {
    return false;
  }
  const deny = cfg.skills?.deny || [];
  if (deny.map((x) => String(x).toLowerCase()).includes(String(skill.name).toLowerCase())) {
    return false;
  }
  const allow = cfg.skills?.allow;
  if (Array.isArray(allow) && allow.length) {
    return allow.map((x) => String(x).toLowerCase()).includes(String(skill.name).toLowerCase());
  }
  return true;
}

/** Sort by priority (higher first), then name. */
export function sortSkills(skills = []) {
  return [...skills].sort((a, b) => {
    const pa = Number(a.meta?.priority ?? a.meta?.order ?? 0);
    const pb = Number(b.meta?.priority ?? b.meta?.order ?? 0);
    if (pb !== pa) return pb - pa;
    return String(a.name).localeCompare(String(b.name));
  });
}

async function readIfExists(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function listSkillDirs(root) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(root, e.name));
  } catch {
    return [];
  }
}

/**
 * Load one skill directory (must contain SKILL.md).
 */
export async function loadSkillDir(dir) {
  const skillFile = path.join(dir, "SKILL.md");
  const raw = await readIfExists(skillFile);
  if (!raw) return null;
  const { meta, body } = parseFrontMatter(raw);
  const name = meta.name || path.basename(dir);
  return {
    name,
    description: meta.description || "",
    body,
    path: skillFile,
    dir,
    meta,
  };
}

/**
 * Discover skills from global + project roots.
 *
 * Precedence (later roots override earlier via the byName map):
 *   1. user/project XClaw skill dirs
 *   2. env-provided extras (XCLAW_GROK_SKILLS / GROK_SKILLS_PATH / XCLAW_EXTRA_SKILLS)
 *      + legacy Grok-sandbox host dirs (included only when present on disk)
 *   3. skills bundled with this install
 *   4. cfg.skills.roots — operator config, highest precedence
 */
export async function defaultSkillRoots({ configDir, cwd, cfg } = {}) {
  const roots = [];
  // 1) User / project XClaw skills
  if (configDir) roots.push(path.join(configDir, "skills"));
  roots.push(path.join(os.homedir(), ".xclaw", "skills"));
  if (cwd) roots.push(path.join(cwd, ".xclaw", "skills"));
  // 2) Env-provided extras — loaded early so XClaw bundled can override
  for (const envKey of ["XCLAW_GROK_SKILLS", "GROK_SKILLS_PATH", "XCLAW_EXTRA_SKILLS"]) {
    if (process.env[envKey]) {
      for (const part of String(process.env[envKey]).split(path.delimiter)) {
        if (part.trim()) roots.push(part.trim());
      }
    }
  }
  // Legacy Grok-sandbox host dirs: fallbacks only, and only when they exist on
  // disk — no hardcoded absolute paths on machines that never had them.
  for (const legacy of [
    path.join(os.homedir(), ".grok", "skills"),
    "/root/.grok/skills",
    "/home/workdir/.grok/skills",
  ]) {
    try {
      await fs.stat(legacy);
      roots.push(legacy);
    } catch {
      /* absent — skip */
    }
  }
  // 3) Bundled with this XClaw install (wins over Grok host copies)
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    roots.push(path.resolve(here, "../../skills"));
    roots.push(path.resolve(here, "../../skills/bundled"));
  } catch {
    /* */
  }
  // 4) Operator-configured roots — explicit config wins over everything
  for (const r of cfg?.skills?.roots || []) {
    if (r && String(r).trim()) roots.push(path.resolve(String(r).trim()));
  }
  return [...new Set(roots.filter(Boolean))];
}

export async function loadAllSkills({ configDir, cwd, cfg } = {}) {
  const roots = await defaultSkillRoots({ configDir, cwd, cfg });

  const byName = new Map();
  for (const root of roots) {
    for (const dir of await listSkillDirs(root)) {
      const skill = await loadSkillDir(dir);
      if (!skill) continue;
      // later roots (project) override earlier
      byName.set(skill.name.toLowerCase(), skill);
    }
  }
  let skills = sortSkills(
    [...byName.values()].filter((s) => isSkillEnabled(s, cfg || {}))
  );
  try {
    const stats = await loadSkillStats(cfg || {});
    skills = attachSkillStats(skills, stats);
  } catch {
    /* stats optional */
  }
  // Manifest-first integrity (skills.lock.json): warn on or exclude skills
  // that drifted from the pinned hashes. Never breaks loading.
  try {
    const { applyIntegrity } = await import("./integrity.mjs");
    const res = await applyIntegrity(skills, { cwd: cwd || process.cwd(), cfg });
    skills = res.skills;
  } catch {
    /* integrity optional */
  }
  // Carry progressive-disclosure prefs to buildContextSections without
  // changing its call sites (the loop passes cfg here but not there).
  // Non-enumerable: invisible to iteration/JSON.
  Object.defineProperty(skills, "_progressive", {
    value: cfg?.skills?.progressive !== false,
    enumerable: false,
  });
  Object.defineProperty(skills, "_inlineMaxChars", {
    value: Number(cfg?.skills?.inlineMaxChars) > 0 ? Number(cfg.skills.inlineMaxChars) : 1500,
    enumerable: false,
  });
  return skills;
}


/** Nearest ancestor (including startDir) containing .git, or null. The
 *  filesystem root never qualifies — a stray /.git must not widen the walk
 *  boundary to the whole filesystem. */
async function findGitRoot(startDir) {
  let d = path.resolve(startDir);
  const fsRoot = path.parse(d).root;
  while (d !== fsRoot) {
    try {
      await fs.stat(path.join(d, ".git"));
      return d;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
  return null;
}

/**
 * Walk upward from cwd looking for project instruction files.
 * Priority names (per directory): XCLAW.md, AGENTS.md, .xclaw/XCLAW.md
 * Nearest directory wins attention (listed last in the prompt).
 * Auto-injected into the agent system prompt when cfg.memory.enabled !== false.
 *
 * TRUST BOUNDARY: the walk stops at the workspace's git root (or at cwd when
 * not inside a git repo, falling back to $HOME if cwd is under it). It never
 * ascends to the filesystem root, so a planted /tmp/XCLAW.md (or any file
 * outside the workspace) cannot inject instructions into the system prompt.
 */
export async function loadMemoryFiles(cwd = process.cwd()) {
  const found = [];
  const seen = new Set();
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  const home = path.resolve(os.homedir());
  let stopAt = await findGitRoot(dir);
  if (!stopAt) {
    // Not a git workspace: allow the home-directory chain (user-owned), else
    // just cwd itself.
    stopAt = dir.startsWith(home + path.sep) || dir === home ? home : dir;
  }
  /** @type {string[]} */
  const names = ["XCLAW.md", "AGENTS.md"];

  while (true) {
    for (const name of names) {
      const fp = path.join(dir, name);
      const raw = await readIfExists(fp);
      if (raw && raw.trim()) {
        const key = path.resolve(fp);
        if (!seen.has(key)) {
          seen.add(key);
          found.push({
            path: fp,
            name,
            body: raw.trim(),
            source: "project",
          });
        }
      }
    }
    // Optional nested path: <dir>/.xclaw/XCLAW.md
    const nested = path.join(dir, ".xclaw", "XCLAW.md");
    const nestedRaw = await readIfExists(nested);
    if (nestedRaw && nestedRaw.trim()) {
      const key = path.resolve(nested);
      if (!seen.has(key)) {
        seen.add(key);
        found.push({
          path: nested,
          name: "XCLAW.md",
          body: nestedRaw.trim(),
          source: "project-dotxclaw",
        });
      }
    }
    if (dir === stopAt || dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Walk collected deepest-first; reverse so nearest is last (wins model attention)
  found.reverse();
  return found;
}

/**
 * Preview what would be injected (CLI / doctor).
 */
export async function previewProjectMemory(cwd = process.cwd(), opts = {}) {
  const files = await loadMemoryFiles(cwd);
  const sections = buildContextSections({
    skills: [],
    memoryFiles: files,
    maxMemoryChars: opts.maxMemoryChars ?? 8000,
  });
  return { files, sections, chars: sections.length };
}

/**
 * Build system prompt sections from skills + memory.
 */
export function buildContextSections({
  skills = [],
  memoryFiles = [],
  maxSkillChars = 6000,
  maxMemoryChars = 8000,
  /** Progressive skill disclosure — index + small-skill inlining (default ON;
   *  also settable via cfg.skills.progressive, carried on the skills array). */
  progressive = undefined,
  /** Skills with bodies at or under this size inline in full (default 1500). */
  inlineMaxChars = undefined,
} = {}) {
  const parts = [];

  if (memoryFiles.length) {
    // Allocate budget from the end of the list (nearest / highest-priority files)
    // so a huge ancestor file cannot starve the workspace XCLAW.md.
    let budget = maxMemoryChars;
    const selected = [];
    for (let i = memoryFiles.length - 1; i >= 0; i--) {
      if (budget <= 0) break;
      const m = memoryFiles[i];
      const body = String(m.body ?? m.content ?? "");
      if (!body.trim()) continue;
      const label = m.name || (m.path ? path.basename(m.path) : "memory");
      const chunk = body.slice(0, budget);
      selected.push(`### ${label} (${m.path || "—"})\n${chunk}`);
      budget -= chunk.length;
    }
    selected.reverse(); // restore outer→inner order; nearest still last in text
    if (selected.length) {
      parts.push(`## Project memory (auto-injected)\nThe following project instructions from XCLAW.md / AGENTS.md are authoritative for this workspace. Follow them unless the user explicitly overrides.\n\n${selected.join("\n\n")}`);
    }
  }

  if (skills.length) {
    // Progressive disclosure (default ON): the prompt carries a compact index
    // of every skill; only skills small enough to fit whole are inlined —
    // nothing is ever cut mid-body. Full bodies load on demand via the
    // xclaw_skill tool. cfg.skills.progressive:false restores the legacy
    // full-body truncation. Flags arrive per-call (opts) or ride the skills
    // array from loadAllSkills (non-enumerable markers).
    const progressiveMode = progressive ?? skills._progressive ?? true;
    const inlineMax =
      Number(inlineMaxChars) > 0
        ? Number(inlineMaxChars)
        : Number(skills._inlineMaxChars) > 0
          ? Number(skills._inlineMaxChars)
          : 1500;

    if (progressiveMode) {
      const index = skills
        .map((s) => {
          const trig = s.meta?.triggers ?? s.meta?.trigger ?? null;
          const trigStr = Array.isArray(trig) ? trig.join(", ") : trig ? String(trig) : "";
          const size = String(s.body || "").length;
          const parts_ = [`- **${s.name}**${s.description ? `: ${s.description}` : ""}`];
          if (trigStr) parts_.push(` _(triggers: ${trigStr})_`);
          if (size > inlineMax) parts_.push(` [${size} chars — load with xclaw_skill]`);
          return parts_.join("");
        })
        .join("\n");
      parts.push(
        `## Available skills\nCall the \`xclaw_skill\` tool with {"name": "<skill>"} to load any skill's full instructions on demand.\n${index}`
      );

      let budget = maxSkillChars;
      const blocks = [];
      for (const s of skills) {
        const body = String(s.body || "");
        if (!body.trim()) continue;
        if (body.length > inlineMax) continue; // big skill — index-only
        if (body.length > budget) continue; // whole-body or nothing
        blocks.push(`### Skill: ${s.name}\n${body}`);
        budget -= body.length;
      }
      if (blocks.length) {
        parts.push(`## Skill details (small skills inlined in full)\n${blocks.join("\n\n")}`);
      }
    } else {
      // Legacy: inline everything, truncated to the running budget.
      let budget = maxSkillChars;
      const blocks = [];
      const index = skills
        .map((s) => `- **${s.name}**${s.description ? `: ${s.description}` : ""}`)
        .join("\n");
      parts.push(`## Available skills\n${index}`);

      for (const s of skills) {
        if (budget <= 0) break;
        const body = s.body.slice(0, budget);
        blocks.push(`### Skill: ${s.name}\n${body}`);
        budget -= body.length;
      }
      if (blocks.length) {
        parts.push(`## Skill details\n${blocks.join("\n\n")}`);
      }
    }
  }

  return parts.join("\n\n");
}
