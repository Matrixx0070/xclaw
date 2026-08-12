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
 */
export async function defaultSkillRoots({ configDir, cwd } = {}) {
  const roots = [];
  // 1) User / project XClaw skills
  if (configDir) roots.push(path.join(configDir, "skills"));
  roots.push(path.join(os.homedir(), ".xclaw", "skills"));
  if (cwd) roots.push(path.join(cwd, ".xclaw", "skills"));
  // 2) Grok sandbox skills (optional host) — loaded early so XClaw bundled can override
  for (const envKey of ["XCLAW_GROK_SKILLS", "GROK_SKILLS_PATH", "XCLAW_EXTRA_SKILLS"]) {
    if (process.env[envKey]) {
      for (const part of String(process.env[envKey]).split(path.delimiter)) {
        if (part.trim()) roots.push(part.trim());
      }
    }
  }
  roots.push(path.join(os.homedir(), ".grok", "skills"));
  roots.push("/root/.grok/skills");
  roots.push("/home/workdir/.grok/skills");
  // 3) Bundled with this XClaw install (wins over Grok host copies)
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    roots.push(path.resolve(here, "../../skills"));
    roots.push(path.resolve(here, "../../skills/bundled"));
  } catch {
    /* */
  }
  return [...new Set(roots.filter(Boolean))];
}

export async function loadAllSkills({ configDir, cwd, cfg } = {}) {
  const roots = await defaultSkillRoots({ configDir, cwd });

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
export function buildContextSections({ skills = [], memoryFiles = [], maxSkillChars = 6000, maxMemoryChars = 8000 } = {}) {
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
    let budget = maxSkillChars;
    const blocks = [];
    // Index first
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

  return parts.join("\n\n");
}
