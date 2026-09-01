/**
 * Flake quarantine — auto-tag flaky cases; exclude from releaseGate until N green.
 * Store: <configDir>/eval-quarantine.json
 *
 * eval-quarantine.json belongs to the config dir that owns the instance, not
 * to whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single
 * quarantine file, so instance B listed instance A's flakes — and the suite
 * wrote into the operator's real `~/.xclaw/eval-quarantine.json`.
 *
 * Production writer (`recordCaseOutcome(cfg)` at eval/runner.mjs:180) already
 * had cfg in scope. `loadConfig()` stamps `paths.configDir` unconditionally
 * (config/load.mjs:187), so a cfg without one is never a real caller.
 * Such a path is `null` rather than guessing at the home dir. Same shape
 * as `skillStatsPath`. Honour existing `XCLAW_CONFIG_DIR`.
 * `recordCaseOutcome` still returns the in-memory case without persisting.
 * `listQuarantined` returns `[]`. `isQuarantined` returns false.
 * Do not `mkdir(null)`.
 */
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Honour `paths.configDir` then `XCLAW_CONFIG_DIR` then null.
 * No home fallback.
 */
export function evalQuarantinePath(cfg = {}) {
  const base = cfg?.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return base ? path.join(base, "eval-quarantine.json") : null;
}

function qPath(cfg) {
  return evalQuarantinePath(cfg);
}

async function load(cfg) {
  const fp = qPath(cfg);
  if (!fp) return { cases: {} };
  try {
    return JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    return { cases: {} };
  }
}

async function save(cfg, data) {
  const fp = qPath(cfg);
  if (!fp) return;
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(data, null, 2));
}

/**
 * Record case outcome. Flake = fail then pass or intermittent fails.
 */
export async function recordCaseOutcome(cfg, caseId, pass) {
  if (!caseId) return null;
  const data = await load(cfg);
  const c = data.cases[caseId] || {
    fails: 0,
    passes: 0,
    consecutiveGreen: 0,
    quarantined: false,
    history: [],
  };
  c.history = [...(c.history || []).slice(-20), { at: new Date().toISOString(), pass }];
  if (pass) {
    c.passes += 1;
    c.consecutiveGreen += 1;
  } else {
    c.fails += 1;
    c.consecutiveGreen = 0;
  }
  const needGreen = cfg?.eval?.quarantineGreenRuns ?? 3;
  const flakeThreshold = cfg?.eval?.quarantineFailThreshold ?? 2;
  if (c.fails >= flakeThreshold && c.passes > 0) {
    c.quarantined = true;
  }
  if (c.quarantined && c.consecutiveGreen >= needGreen) {
    c.quarantined = false;
  }
  data.cases[caseId] = c;
  await save(cfg, data);
  return c;
}

export async function listQuarantined(cfg) {
  const data = await load(cfg);
  return Object.entries(data.cases)
    .filter(([, v]) => v.quarantined)
    .map(([id, v]) => ({ id, ...v }));
}

export async function isQuarantined(cfg, caseId) {
  const data = await load(cfg);
  return Boolean(data.cases[caseId]?.quarantined);
}

export async function filterQuarantinedResults(cfg, results = []) {
  const data = await load(cfg);
  const kept = [];
  const skipped = [];
  for (const r of results) {
    if (data.cases[r.id]?.quarantined) skipped.push(r);
    else kept.push(r);
  }
  return { kept, skipped };
}
