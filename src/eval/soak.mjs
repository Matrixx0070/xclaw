/**
 * Soak run ledger + flake tracking (Phase K).
 * Store: <configDir>/soak/{runs.jsonl,flakes.jsonl,summary.json}
 *
 * The soak ledger belongs to the config dir that owns the instance, not
 * to whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single
 * soak/ directory, so instance B listed instance A's nights — and the suite
 * wrote into the operator's real `~/.xclaw/soak`.
 *
 * Production writers (`appendSoakRun(cfg)` / `appendFlake(cfg)` at
 * scripts/soak-run.mjs and scripts/soak-multinight.mjs, both via
 * `loadConfig()`) already had cfg in scope. `loadConfig()` stamps
 * `paths.configDir` unconditionally (config/load.mjs:187), so a cfg
 * without one is never a real caller. Such a path is `null` rather than
 * guessing at the home dir. Same shape as `evalQuarantinePath`. Honour
 * existing `XCLAW_CONFIG_DIR`. `appendSoakRun` / `appendFlake` still
 * return the in-memory row without persisting. `soakPaths.dir` is null.
 * `getSoakSummary` rebuilds in-memory. Do not `mkdir(null)`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { redactEvent } from "../security/redact-secrets.mjs";

/**
 * Honour `paths.configDir` then `XCLAW_CONFIG_DIR` then null.
 * No home fallback.
 */
export function soakStoreDir(cfg = {}) {
  const base = cfg?.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return base ? path.join(base, "soak") : null;
}

function baseDir(cfg) {
  return soakStoreDir(cfg);
}

export function soakPaths(cfg) {
  const d = baseDir(cfg);
  if (!d) return { dir: null, runs: null, flakes: null, summary: null };
  return {
    dir: d,
    runs: path.join(d, "runs.jsonl"),
    flakes: path.join(d, "flakes.jsonl"),
    summary: path.join(d, "summary.json"),
  };
}

export async function appendSoakRun(cfg, run) {
  const p = soakPaths(cfg);
  const row = redactEvent({
    at: new Date().toISOString(),
    ...run,
  });
  if (!p.dir) return row;
  await fs.mkdir(p.dir, { recursive: true });
  await fs.appendFile(p.runs, JSON.stringify(row) + "\n");
  await rebuildSoakSummary(cfg);
  return row;
}

export async function appendFlake(cfg, flake) {
  const p = soakPaths(cfg);
  const row = redactEvent({ at: new Date().toISOString(), ...flake });
  if (!p.dir) return row;
  await fs.mkdir(p.dir, { recursive: true });
  await fs.appendFile(p.flakes, JSON.stringify(row) + "\n");
  await rebuildSoakSummary(cfg);
  return row;
}

async function readJsonl(fp) {
  try {
    const raw = await fs.readFile(fp, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function emptySummary() {
  return {
    at: new Date().toISOString(),
    nights: 0,
    runs: 0,
    totalCases: 0,
    passed: 0,
    failed: 0,
    passRate: null,
    flakes: 0,
    flakeRate: null,
    flakeBudgetOk: true,
    lastRuns: [],
    gate: {
      minNights: Number(process.env.SOAK_MIN_NIGHTS || 3),
      nightsOk: false,
      passOk: null,
    },
  };
}

export async function rebuildSoakSummary(cfg) {
  const p = soakPaths(cfg);
  if (!p.dir) return emptySummary();
  const runs = await readJsonl(p.runs);
  const flakes = await readJsonl(p.flakes);
  const totalCases = runs.reduce((s, r) => s + (r.total || 0), 0);
  const passed = runs.reduce((s, r) => s + (r.passed || 0), 0);
  const failed = runs.reduce((s, r) => s + (r.failed || 0), 0);
  const flakeCount = flakes.length;
  const summary = {
    at: new Date().toISOString(),
    nights: new Set(runs.map((r) => (r.at || "").slice(0, 10))).size,
    runs: runs.length,
    totalCases,
    passed,
    failed,
    passRate: totalCases ? passed / totalCases : null,
    flakes: flakeCount,
    flakeRate: totalCases ? flakeCount / totalCases : null,
    flakeBudgetOk: totalCases >= 50 ? flakeCount / totalCases <= 0.02 : flakeCount <= 1,
    lastRuns: runs.slice(-5),
    gate: {
      minNights: Number(process.env.SOAK_MIN_NIGHTS || 3),
      nightsOk:
        new Set(runs.map((r) => (r.at || "").slice(0, 10))).size >=
        Number(process.env.SOAK_MIN_NIGHTS || 3),
      passOk: totalCases ? passed / totalCases >= 0.9 : null,
    },
  };
  await fs.mkdir(p.dir, { recursive: true });
  await fs.writeFile(p.summary, JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

export async function getSoakSummary(cfg) {
  const p = soakPaths(cfg);
  if (!p.dir) return emptySummary();
  try {
    return JSON.parse(await fs.readFile(p.summary, "utf8"));
  } catch {
    return rebuildSoakSummary(cfg);
  }
}

export async function seedMultiNightSoak(cfg, nights = 3, nightResults = []) {
  const out = [];
  const base = Date.now();
  for (let i = 0; i < nights; i++) {
    const day = new Date(base - (nights - 1 - i) * 86400000);
    const at = day.toISOString();
    const sample = nightResults[i] || {
      tags: ["smoke"],
      passed: 1,
      failed: 0,
      total: 1,
      passRate: 1,
      results: [{ id: "soak-seed", pass: true, turns: 1 }],
    };
    const row = await appendSoakRun(cfg, { ...sample, at });
    out.push(row);
  }
  return { nights, runs: out, summary: await rebuildSoakSummary(cfg) };
}
