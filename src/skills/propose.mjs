/**
 * H2 — Propose skill drafts from repeated job/eval failures.
 * Does NOT auto-install; writes drafts under ~/.xclaw/skill-proposals/
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function proposalsDir(cfg) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "skill-proposals");
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
  await fs.mkdir(dir, { recursive: true });
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

  const fp = path.join(dir, `${id}.md`);
  await fs.writeFile(fp, body);
  return { id, name, path: fp, enabled: false };
}

export async function listProposals(cfg, limit = 20) {
  const dir = proposalsDir(cfg);
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
  const dir = proposalsDir(cfg);
  const fp = path.isAbsolute(proposalFile)
    ? proposalFile
    : path.join(dir, proposalFile);
  const raw = await fs.readFile(fp, "utf8");
  // enable in front matter
  let body = raw.replace(/enabled:\s*false/i, "enabled: true");
  if (!/^---/m.test(body)) {
    throw new Error("proposal missing front matter");
  }
  const skillsRoot =
    cfg?.paths?.skillsDir ||
    path.join(cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw"), "skills");
  // name from front matter
  const nm = body.match(/^name:\s*(.+)$/m);
  const name = (nm ? nm[1].trim() : path.basename(fp, ".md")).replace(/[^a-zA-Z0-9._-]/g, "-");
  const destDir = path.join(skillsRoot, name);
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
  return { name, path: dest, from: fp };
}

export async function rejectProposal(cfg, proposalFile, reason = "") {
  const dir = proposalsDir(cfg);
  const fp = path.isAbsolute(proposalFile)
    ? proposalFile
    : path.join(dir, proposalFile);
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
  await fs.mkdir(dir, { recursive: true });
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

  const fp = path.join(dir, `${id}.md`);
  await fs.writeFile(fp, body);
  return { ok: true, id, name, path: fp, enabled: false };
}
