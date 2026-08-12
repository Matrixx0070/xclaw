/**
 * Flake quarantine — auto-tag flaky cases; exclude from releaseGate until N green.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function qPath(cfg) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "eval-quarantine.json");
}

async function load(cfg) {
  try {
    return JSON.parse(await fs.readFile(qPath(cfg), "utf8"));
  } catch {
    return { cases: {} };
  }
}

async function save(cfg, data) {
  const fp = qPath(cfg);
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
