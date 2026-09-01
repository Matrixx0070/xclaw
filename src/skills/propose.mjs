/**
 * H2 — Propose skill drafts from repeated job/eval failures.
 * Store: <configDir>/skill-proposals/
 *
 * skill-proposals/ belongs to the config dir that owns the instance, not
 * to whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single
 * skill-proposals/ directory, so instance B listed instance A's drafts —
 * and the suite wrote into the operator's real `~/.xclaw/skill-proposals`.
 *
 * Production writers (`proposeSkillFromFailure(cfg)` at eval/runner.mjs:154
 * and jobs/job.mjs:433; `proposeSkillFromSuccess(cfg)` at jobs/job.mjs:461)
 * already had cfg in scope. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null` rather than guessing at the home dir.
 * Same shape as `soakStoreDir`. Honour existing `XCLAW_CONFIG_DIR`.
 * `proposeSkillFromFailure` / `proposeSkillFromSuccess` still return the
 * in-memory draft without persisting. `listProposals` returns `[]`.
 * Do not `mkdir(null)`. Keep honouring `paths.skillsDir` for install dest.
 */
import fs from "node:fs/promises";
import path from "node:path";


/**
 * P2 — Owner-gated skill writeback.
 * Prod never auto-installs skills unless explicitly allowed.
 *
 * Allow when:
 *   - profile is lab/dev, OR
 *   - cfg.skills.allowInstall === true, OR
 *   - XCLAW_SKILLS_INSTALL=1, OR
 *   - opts.ownerApproved === true
 */
export function canInstallSkills(cfg = {}, opts = {}) {
  if (opts.ownerApproved === true) return { ok: true, reason: "owner_approved" };
  if (
    process.env.XCLAW_SKILLS_INSTALL === "1" ||
    process.env.XCLAW_SKILLS_INSTALL === "true"
  ) {
    return { ok: true, reason: "env" };
  }
  if (cfg?.skills?.allowInstall === true) return { ok: true, reason: "config" };
  const profile = String(cfg?.profile || process.env.XCLAW_PROFILE || "lab").toLowerCase();
  if (profile === "prod") {
    return {
      ok: false,
      reason: "prod_requires_owner",
      hint: "Set skills.allowInstall=true, XCLAW_SKILLS_INSTALL=1, or pass ownerApproved",
    };
  }
  return { ok: true, reason: `profile_${profile}` };
}

/**
 * Honour `paths.configDir` then `XCLAW_CONFIG_DIR` then null.
 * No home fallback.
 */
export function skillProposalsDir(cfg = {}) {
  const base = cfg?.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return base ? path.join(base, "skill-proposals") : null;
}

function proposalsDir(cfg) {
  return skillProposalsDir(cfg);
}

function skillsRoot(cfg) {
  if (cfg?.paths?.skillsDir) return cfg.paths.skillsDir;
  const base = cfg?.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return base ? path.join(base, "skills") : null;
}

/**
 * @param {object} cfg
 * @param {object} opts
 * @param {string} opts.caseId
 * @param {string} opts.goal
 * @param {string[]} [opts.failures]
 * @param {string} [opts.text]
 * @param {object[]} [opts.toolTrace]
 */
export async function proposeSkillFromFailure(cfg, opts) {
  const dir = proposalsDir(cfg);
  const id = `${opts.caseId || "job"}_${Date.now().toString(36)}`;
  const name = `auto-${(opts.caseId || "task").replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`.slice(0, 48);

  const failures = opts.failures || [];
  const tools = (opts.toolTrace || [])
    .slice(0, 8)
    .map((t) => `- ${t.name}: ${JSON.stringify(t.args || {}).slice(0, 120)}`)
    .join("\n");

  const body = `---
name: ${name}
description: Auto-draft from failed task ${opts.caseId || ""}. Review before enabling.
version: 1
priority: 0
enabled: false
---

# Proposed skill (REVIEW REQUIRED)

## Goal pattern
${opts.goal || "(unknown)"}

## Observed failures
${failures.map((f) => `- ${f}`).join("\n") || "- (none listed)"}

## Recent tool attempts
${tools || "- (none)"}

## Guidance to encode (edit me)
- Prefer the minimal tool sequence that satisfies verify checks.
- After writing files, re-read to confirm contents.
- Never invent file contents you have not read.
- If a path is missing, say so and stop (do not fabricate).

## Agent final text (excerpt)
\`\`\`
${String(opts.text || "").slice(0, 800)}
\`\`\`
`;

  const fp = dir ? path.join(dir, `${id}.md`) : null;
  if (!dir) return { id, name, path: fp, enabled: false };
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fp, body);
  return { id, name, path: fp, enabled: false };
}

export async function listProposals(cfg, limit = 20) {
  const dir = proposalsDir(cfg);
  if (!dir) return [];
  let files = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  files.sort().reverse();
  const out = [];
  for (const f of files.slice(0, limit)) {
    const fp = path.join(dir, f);
    const st = await fs.stat(fp);
    out.push({ file: f, path: fp, mtime: st.mtime.toISOString() });
  }
  return out;
}


/**
 * Install a reviewed proposal into skills dir (enabled).
 * @param {object} cfg
 * @param {string} proposalFile — filename or absolute path
 * @param {{ force?: boolean }} [opts]
 */
export async function installProposal(cfg, proposalFile, opts = {}) {
  const gate = canInstallSkills(cfg, opts);
  if (!gate.ok) {
    return { ok: false, installed: false, ...gate };
  }
  const dir = proposalsDir(cfg);
  if (!dir && !path.isAbsolute(proposalFile || "")) {
    return { ok: false, installed: false, reason: "no_config" };
  }
  const fp = path.isAbsolute(proposalFile)
    ? proposalFile
    : path.join(dir, proposalFile);
  const raw = await fs.readFile(fp, "utf8");
  // enable in front matter
  let body = raw.replace(/enabled:\s*false/i, "enabled: true");
  if (!/^---/m.test(body)) {
    throw new Error("proposal missing front matter");
  }
  const destRoot = skillsRoot(cfg);
  if (!destRoot) {
    return { ok: false, installed: false, reason: "no_config" };
  }
  // name from front matter
  const nm = body.match(/^name:\s*(.+)$/m);
  const name = (nm ? nm[1].trim() : path.basename(fp, ".md")).replace(/[^a-zA-Z0-9._-]/g, "-");
  const destDir = path.join(destRoot, name);
  await fs.mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, "SKILL.md");
  if (!opts.force) {
    try {
      await fs.access(dest);
      throw new Error(`skill already exists: ${dest} (use force)`);
    } catch (e) {
      if (e.message?.includes("already exists")) throw e;
    }
  }
  await fs.writeFile(dest, body);
  // Archive the source proposal so it leaves the review queue — leaving it
  // listed invited a second Install click, which errors with "already exists".
  let archived = null;
  try {
    if (!dir) throw new Error("no_config");
    const installedDir = path.join(dir, "installed");
    await fs.mkdir(installedDir, { recursive: true });
    archived = path.join(installedDir, path.basename(fp));
    await fs.rename(fp, archived);
  } catch {
    archived = null; // best-effort: the install itself already succeeded
  }
  return { ok: true, installed: true, name, path: dest, from: fp, archived };
}

export async function rejectProposal(cfg, proposalFile, reason = "") {
  const dir = proposalsDir(cfg);
  if (!dir && !path.isAbsolute(proposalFile || "")) {
    return { path: null, reason: "no_config" };
  }
  const fp = path.isAbsolute(proposalFile)
    ? proposalFile
    : path.join(dir, proposalFile);
  if (!dir) {
    return { path: null, reason: "no_config" };
  }
  const rejected = path.join(dir, "rejected");
  await fs.mkdir(rejected, { recursive: true });
  const base = path.basename(fp);
  const dest = path.join(rejected, base);
  await fs.rename(fp, dest);
  if (reason) {
    await fs.writeFile(dest + ".reason.txt", reason);
  }
  return { path: dest };
}

/**
 * R5 — Propose skill draft from a *successful* job (review-only).
 */
export async function proposeSkillFromSuccess(cfg, opts = {}) {
  if (cfg?.skills?.proposeOnSuccess === false) {
    return { ok: false, reason: "proposeOnSuccess disabled" };
  }
  const minTools = Number(cfg?.skills?.proposeOnSuccessMinTools ?? 2);
  const tools = opts.toolTrace || [];
  if (tools.length < minTools) {
    return { ok: false, reason: `need >= ${minTools} tools` };
  }

  const dir = proposalsDir(cfg);
  const id = `ok-${(opts.caseId || "job").replace(/[^a-z0-9-]/gi, "-")}_${Date.now().toString(36)}`.slice(0, 64);
  const name = `learned-${(opts.caseId || opts.goal || "task")
    .replace(/[^a-z0-9-]/gi, "-")
    .toLowerCase()}`.slice(0, 48);

  const toolLines = tools
    .slice(0, 12)
    .map((t) => `- ${t.name}: ${JSON.stringify(t.args || {}).slice(0, 140)}`)
    .join("\n");

  const body = `---
name: ${name}
description: Auto-draft from successful task. Review before enabling.
version: 1
priority: 5
enabled: false
source: success
sourceVerdict: ${opts.verdict || "unverified"}
---

# Learned skill (REVIEW REQUIRED)

## Goal pattern
${opts.goal || "(unknown)"}

## Successful tool sequence
${toolLines || "- (none)"}

## What worked
- Follow this tool order when the goal matches the pattern above.
- Re-read or list after writes when accuracy matters.
- Prefer the same working directory conventions used here.

## Agent summary (excerpt)
\`\`\`
${String(opts.text || "").slice(0, 800)}
\`\`\`
`;

  const fp = dir ? path.join(dir, `${id}.md`) : null;
  if (!dir) return { ok: true, id, name, path: fp, enabled: false };
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fp, body);
  return { ok: true, id, name, path: fp, enabled: false };
}
