/**
 * Manifest-first skill integrity ("signed skills" lite — no external trust
 * infra). A workspace lockfile pins the sha256 of every skill's SKILL.md
 * (RAW file bytes — front-matter feeds the prompt index, so it is covered);
 * the loader then warns on or excludes skills that drifted from the manifest.
 *
 * Modes (cfg.skills.integrity wins when set explicitly):
 *   off      — no checking (default when no lockfile exists)
 *   warn     — load everything, mark + warn on drift (default when a lockfile exists)
 *   enforce  — EXCLUDE changed/unmanifested skills from injection
 *              (default in profile=prod when a lockfile exists)
 *
 * CLI: `xclaw skills lock` regenerates the manifest, `xclaw skills verify`
 * reports per-skill status and exits 1 on drift.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const LOCKFILE_NAME = "skills.lock.json";
export const LOCK_VERSION = 1;

/** Nearest ancestor (including startDir) containing .git; never the fs root. */
async function findWorkspaceRoot(startDir) {
  let d = path.resolve(startDir || process.cwd());
  const fsRoot = path.parse(d).root;
  while (d !== fsRoot) {
    try {
      await fs.stat(path.join(d, ".git"));
      return d;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return path.resolve(startDir || process.cwd());
}

/** Canonical lockfile path: the workspace git root (or cwd outside a repo). */
export async function lockfilePathFor(cwd) {
  return path.join(await findWorkspaceRoot(cwd), LOCKFILE_NAME);
}

export function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** @returns {Promise<{path: string, data: object|null}>} */
export async function readLockfile(cwd) {
  const p = await lockfilePathFor(cwd);
  try {
    const raw = await fs.readFile(p, "utf8");
    const data = JSON.parse(raw);
    if (data && data.version === LOCK_VERSION && data.skills && typeof data.skills === "object") {
      return { path: p, data };
    }
    return { path: p, data: null };
  } catch {
    return { path: p, data: null };
  }
}

/** Build lock data from discovered skills (hashes RAW SKILL.md bytes). */
export async function buildLockData(skills) {
  const out = { version: LOCK_VERSION, generatedAt: new Date().toISOString(), skills: {} };
  for (const s of skills) {
    if (!s?.name || !s?.path) continue;
    let hash = null;
    try {
      hash = sha256Hex(await fs.readFile(s.path));
    } catch {
      continue; // unreadable — leave out; verify will flag it as unmanifested
    }
    out.skills[String(s.name)] = { sha256: hash, path: s.path, root: s.dir || null };
  }
  return out;
}

export async function writeLockfile(cwd, data) {
  const p = await lockfilePathFor(cwd);
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
  await fs.rename(tmp, p);
  return p;
}

/**
 * Mode matrix. Explicit cfg.skills.integrity always wins.
 * @returns {"off"|"warn"|"enforce"}
 */
export function resolveIntegrityMode(cfg = {}, hasLockfile = false) {
  const explicit = String(cfg?.skills?.integrity || "").toLowerCase();
  if (["off", "warn", "enforce"].includes(explicit)) return explicit;
  const profile = String(cfg?.profile || "").toLowerCase();
  // Prod always enforces — missing lockfile means refuse unpinned injection
  if (profile === "prod") return "enforce";
  if (!hasLockfile) return "off";
  return "warn";
}

/**
 * Annotate each skill with integrity status vs the lock data:
 *   verified | changed | unmanifested
 * plus a `missing` list for manifested skills absent from disk.
 */
export async function evaluateSkills(skills, lockData) {
  const seen = new Set();
  const evaluated = [];
  for (const s of skills) {
    const entry = lockData?.skills?.[String(s.name)];
    let status = "unmanifested";
    if (entry?.sha256) {
      seen.add(String(s.name));
      try {
        const hash = sha256Hex(await fs.readFile(s.path));
        status = hash === entry.sha256 ? "verified" : "changed";
      } catch {
        status = "changed"; // manifested but unreadable → treat as drift
      }
    }
    evaluated.push({ skill: s, status });
  }
  const missing = Object.keys(lockData?.skills || {}).filter((n) => !seen.has(n));
  return { evaluated, missing };
}

// Warn once per process per (skill, status) — loadAllSkills runs every turn.
const warned = new Set();

/**
 * Main loader hook. Returns the (possibly filtered) skills plus a report.
 * Never throws — integrity must not break skill loading.
 * @returns {Promise<{skills: object[], mode: string, report: object|null}>}
 */
export async function applyIntegrity(skills, { cwd, cfg } = {}) {
  const { data } = await readLockfile(cwd);
  const mode = resolveIntegrityMode(cfg, Boolean(data));
  if (mode === "off") return { skills, mode, report: null };
  // Enforce without lockfile: refuse all unpinned skills (prod default)
  if (mode === "enforce" && !data) {
    const key = "__no_lockfile__";
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(
        `[xclaw] skill integrity enforce: no ${LOCKFILE_NAME} — excluding all skills` +
          ` (run: xclaw skills lock)`
      );
    }
    return {
      skills: [],
      mode,
      report: {
        excluded: (skills || []).map((s) => s?.name).filter(Boolean),
        missing: [],
        total: (skills || []).length,
        reason: "no_lockfile",
      },
    };
  }
  if (!data) return { skills, mode, report: null };

  const { evaluated, missing } = await evaluateSkills(skills, data);
  const kept = [];
  const excluded = [];
  for (const { skill, status } of evaluated) {
    skill.integrity = status;
    const drifted = status !== "verified";
    if (drifted) {
      const key = `${skill.name}:${status}`;
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(
          `[xclaw] skill integrity ${mode}: "${skill.name}" is ${status}` +
            (mode === "enforce" ? " — excluded from injection" : "") +
            ` (run: xclaw skills lock)`
        );
      }
    }
    if (mode === "enforce" && drifted) excluded.push(skill.name);
    else kept.push(skill);
  }
  return {
    skills: kept,
    mode,
    report: { excluded, missing, total: evaluated.length },
  };
}

/** Test helper */
export function _resetWarnedForTests() {
  warned.clear();
}

export default {
  LOCKFILE_NAME,
  LOCK_VERSION,
  lockfilePathFor,
  readLockfile,
  buildLockData,
  writeLockfile,
  resolveIntegrityMode,
  evaluateSkills,
  applyIntegrity,
  sha256Hex,
};
