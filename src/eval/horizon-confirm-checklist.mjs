/**
 * Confirm-live checklist runner — fail-closed, dry-run by default.
 * Spend only with --spend AND XCLAW_SOAK_CONFIRM=1.
 */
import { spawnSync } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAutonomyScorecard } from "./horizon-scorecard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const state = { checklist_ok: 0, last: null };

export function getChecklistOk() {
  return state.checklist_ok;
}
export function resetChecklistMetrics() {
  state.checklist_ok = 0;
  state.last = null;
}
export function lastChecklist() {
  return state.last;
}
export function renderChecklistMetrics() {
  return `xclaw_horizon_checklist_ok ${state.checklist_ok}\n`;
}

export function checklistEvidencePath(base) {
  return path.resolve(
    base || process.cwd(),
    ".xclaw-evidence",
    "last-checklist.json"
  );
}

export async function writeChecklistResult(result, opts = {}) {
  const fp = checklistEvidencePath(opts.base);
  await fsp.mkdir(path.dirname(fp), { recursive: true });
  await fsp.writeFile(fp, JSON.stringify(result, null, 2) + "\n", "utf8");
  return fp;
}

export async function readChecklistResult(opts = {}) {
  const fp = checklistEvidencePath(opts.base);
  try {
    const j = JSON.parse(await fsp.readFile(fp, "utf8"));
    return { ok: true, path: fp, result: j };
  } catch {
    // Same catch class as readLiveSoakReport / readLastScorecard:
    // truncated / empty checkout evidence must not throw. Class 10:
    // no sample is not a fault. doctorHorizon uses in-memory
    // lastChecklist(); this disk reader still shares the evidence dir.
    return { ok: false, path: fp, result: null };
  }
}

/**
 * @param {{ spend?: boolean, base?: string, root?: string }} opts
 */
export async function runConfirmChecklist(opts = {}) {
  const baseRoot = opts.root || root;
  const steps = [];
  const spend = opts.spend === true;
  const confirm = process.env.XCLAW_SOAK_CONFIRM === "1";

  if (spend && !confirm) {
    const result = {
      ok: false,
      code: "CONFIRM_REQUIRED",
      exitCode: 2,
      spend: true,
      confirm: false,
      steps,
      at: new Date().toISOString(),
    };
    state.checklist_ok = 0;
    state.last = result;
    await writeChecklistResult(result, opts);
    return result;
  }

  const card = await buildAutonomyScorecard({});
  steps.push({
    name: "scorecard",
    ok: card.ok === true,
    packComplete: card.packComplete,
    hmacFail: card.hmacFail,
  });
  if (!card.ok) {
    const result = {
      ok: false,
      code: "SCORECARD_FAIL",
      exitCode: 1,
      scorecard: card,
      steps,
      at: new Date().toISOString(),
    };
    state.checklist_ok = 0;
    state.last = result;
    await writeChecklistResult(result, opts);
    return result;
  }

  if (!spend) {
    const dry = spawnSync(
      "bash",
      [path.join(baseRoot, "scripts/horizon-live-g10-g14.sh")],
      {
        cwd: baseRoot,
        encoding: "utf8",
        env: { ...process.env, XCLAW_SOAK_CONFIRM: "0" },
      }
    );
    const dryOk = dry.status === 0;
    steps.push({
      name: "g10_g14_dry_run",
      ok: dryOk,
      status: dry.status,
    });
    if (!dryOk) {
      const result = {
        ok: false,
        code: "DRY_RUN_FAIL",
        exitCode: 1,
        steps,
        at: new Date().toISOString(),
      };
      state.checklist_ok = 0;
      state.last = result;
      await writeChecklistResult(result, opts);
      return result;
    }
  } else {
    const live = spawnSync(
      "bash",
      [path.join(baseRoot, "scripts/horizon-live-g10-g14.sh")],
      {
        cwd: baseRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          XCLAW_SOAK_CONFIRM: "1",
          XCLAW_SOAK_MAX_USD: process.env.XCLAW_SOAK_MAX_USD || "2",
        },
      }
    );
    steps.push({
      name: "g10_g14_confirm_live",
      ok: live.status === 0,
      status: live.status,
    });
    if (live.status !== 0) {
      const result = {
        ok: false,
        code: "LIVE_FAIL",
        exitCode: 1,
        steps,
        at: new Date().toISOString(),
      };
      state.checklist_ok = 0;
      state.last = result;
      await writeChecklistResult(result, opts);
      return result;
    }
  }

  const result = {
    ok: true,
    code: spend ? "SPEND_OK" : "DRY_OK",
    exitCode: 0,
    spend,
    confirm: spend ? true : false,
    steps,
    metrics: renderChecklistMetrics(),
    at: new Date().toISOString(),
  };
  state.checklist_ok = 1;
  state.last = result;
  await writeChecklistResult(result, opts);
  return result;
}

export default {
  runConfirmChecklist,
  renderChecklistMetrics,
  lastChecklist,
  readChecklistResult,
};
