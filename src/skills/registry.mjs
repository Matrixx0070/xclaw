/**
 * H2 — Skill registry: version + success_rate from job outcomes.
 * Store: <configDir>/skill-stats.json
 *
 * skill-stats.json belongs to the config dir that owns the instance, not
 * to whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single
 * stats file, so instance B listed instance A's skill rates — and the suite
 * wrote into the operator's real `~/.xclaw/skill-stats.json`.
 *
 * Production writer (`recordSkillOutcome(cfg)` at eval/runner.mjs:151) and
 * production readers (`loadSkillStats(cfg)` at skills/loader.mjs:193 and
 * gateway/routes/eval-queue.mjs:234) already had cfg in scope.
 * `loadConfig()` stamps `paths.configDir` unconditionally
 * (config/load.mjs:187), so a cfg without one is never a real caller.
 * Such a path is `null` rather than guessing at the home dir. Same shape
 * as `evalHistoryPath`. Honour existing `XCLAW_CONFIG_DIR`.
 * `recordSkillOutcome` still returns the in-memory stats without persisting.
 * `loadSkillStats` returns `{ version: 1, skills: {} }`. Do not `mkdir(null)`.
 */
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Honour `paths.configDir` then `XCLAW_CONFIG_DIR` then null.
 * No home fallback.
 */
export function skillStatsPath(cfg = {}) {
  const base = cfg?.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return base ? path.join(base, "skill-stats.json") : null;
}

function statsPath(cfg) {
  return skillStatsPath(cfg);
}

export async function loadSkillStats(cfg) {
  const fp = statsPath(cfg);
  if (!fp) return { version: 1, skills: {} };
  try {
    return JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    return { version: 1, skills: {} };
  }
}

export async function saveSkillStats(cfg, data) {
  const fp = statsPath(cfg);
  if (!fp) return;
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
