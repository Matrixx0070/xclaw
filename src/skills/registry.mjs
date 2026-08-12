/**
 * H2 — Skill registry: version + success_rate from job outcomes.
 * Store: ~/.xclaw/skill-stats.json
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function statsPath(cfg) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "skill-stats.json");
}

export async function loadSkillStats(cfg) {
  try {
    return JSON.parse(await fs.readFile(statsPath(cfg), "utf8"));
  } catch {
    return { version: 1, skills: {} };
  }
}

export async function saveSkillStats(cfg, data) {
  const fp = statsPath(cfg);
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(data, null, 2));
}

/**
 * Record outcome for skills that were active in a job/eval.
 * @param {object} cfg
 * @param {string[]} skillNames
 * @param {boolean} pass
 * @param {number} [turns]
 */
export async function recordSkillOutcome(cfg, skillNames = [], pass, turns) {
  if (!skillNames.length) return null;
  const data = await loadSkillStats(cfg);
  for (const name of skillNames) {
    const key = String(name);
    const s = data.skills[key] || {
      name: key,
      version: 1,
      runs: 0,
      successes: 0,
      failures: 0,
      totalTurns: 0,
      successRate: 0,
      updatedAt: null,
    };
    s.runs += 1;
    if (pass) s.successes += 1;
    else s.failures += 1;
    s.totalTurns += turns || 0;
    s.successRate = s.runs ? s.successes / s.runs : 0;
    s.updatedAt = new Date().toISOString();
    data.skills[key] = s;
  }
  await saveSkillStats(cfg, data);
  return data;
}

/**
 * Merge registry stats onto loaded skill objects (non-mutating copy).
 */
export function attachSkillStats(skills, stats) {
  const map = stats?.skills || {};
  return (skills || []).map((sk) => {
    const st = map[sk.name];
    if (!st) return { ...sk, version: sk.meta?.version || 1, successRate: null, runs: 0 };
    return {
      ...sk,
      version: st.version || sk.meta?.version || 1,
      successRate: st.successRate,
      runs: st.runs,
      successes: st.successes,
      failures: st.failures,
    };
  });
}

/**
 * Bump skill version after a manual or auto improvement.
 */
export async function bumpSkillVersion(cfg, name, reason = "") {
  const data = await loadSkillStats(cfg);
  const s = data.skills[name] || {
    name,
    version: 1,
    runs: 0,
    successes: 0,
    failures: 0,
    totalTurns: 0,
    successRate: 0,
  };
  s.version = (s.version || 1) + 1;
  s.lastBumpReason = reason;
  s.updatedAt = new Date().toISOString();
  data.skills[name] = s;
  await saveSkillStats(cfg, data);
  return s;
}
