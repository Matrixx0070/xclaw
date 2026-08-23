/**
 * Self-evolution + hands-free operator loop.
 *
 * Not unconstrained AGI — a closed loop:
 *   observe jobs → propose skills/preferences → score → optional promote
 *   → resume interrupted work → alert owner only when blocked
 *
 * Hands-free profile (owner away from keyboard):
 *   autonomy.level=full|lab + heartbeat + harness defaults + evolve.autoPromote (lab only)
 *   prod: proposals stay review-only unless ownerApproved / skills.allowInstall
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveAutonomyLevel } from "../config/autonomy-policy.mjs";
import { principlesForLevel } from "../agent/principles.mjs";
import {
  listPendingApprovals,
  getSharedApprovalGate,
} from "../security/approvals.mjs";
import { getCostGovernorStatus } from "../tokens/cost-governor.mjs";
import { listCheckpoints, resumeJobFromCheckpoint, pruneCheckpoints } from "../jobs/checkpoint.mjs";
import {
  readSkillLoopMetrics,
  promoteAndInstall,
} from "../skills/loop.mjs";
import { listProposals, canInstallSkills, installProposal } from "../skills/propose.mjs";
import { queueStats, startQueueWorker, listQueue } from "../jobs/queue.mjs";

function evolveDir(cfg) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "evolution");
}

async function appendEvolveLog(cfg, row) {
  const d = evolveDir(cfg);
  await fs.mkdir(d, { recursive: true });
  const fp = path.join(d, "events.jsonl");
  await fs.appendFile(
    fp,
    JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n"
  );
  return fp;
}

/**
 * Snapshot: what blocks hands-free operation right now?
 */
export async function handsFreeStatus(cfg) {
  const level = resolveAutonomyLevel(cfg);
  const principles = principlesForLevel(level);
  const pendingApprovals = (() => {
    try {
      return listPendingApprovals(cfg);
    } catch {
      return [];
    }
  })();

  let cost = null;
  try {
    cost = await getCostGovernorStatus(cfg);
  } catch {
    cost = { ok: true, spentUsd: 0 };
  }

  let checkpoints = [];
  try {
    checkpoints = await listCheckpoints(cfg, { limit: 20 });
  } catch {
    /* */
  }
  const interrupted = checkpoints.filter((c) => {
    if (!c || c.status === "resumed" || c.status === "resuming" || c.status === "succeeded") {
      return false;
    }
    if (c.resumedBy) return false;
    return (
      c.status === "running" ||
      c.midRun ||
      (c.status && c.status !== "succeeded" && !c.pass)
    );
  });

  let proposals = [];
  try {
    proposals = await listProposals(cfg);
  } catch {
    proposals = [];
  }
  const pendingProposals = (proposals || []).filter(
    (p) => p && (p.enabled === false || p.status === "proposed" || !p.installed)
  );

  const installGate = canInstallSkills(cfg, { ownerApproved: false });
  const hb = cfg.autonomy?.heartbeat || {};
  const evolve = cfg.evolve || cfg.autonomy?.evolve || {};

  const blockers = [];
  if (pendingApprovals.length) {
    blockers.push({
      kind: "approval",
      count: pendingApprovals.length,
      hint: "xclaw approvals list / approve",
    });
  }
  if (cost && cost.ok === false) {
    blockers.push({
      kind: "budget",
      message: cost.message,
      code: cost.code || "BUDGET_EXCEEDED",
    });
  }
  if (level === "off") {
    blockers.push({ kind: "autonomy", message: "autonomy.level=off" });
  }
  if (hb.enabled !== true && (level === "full" || evolve.requireHeartbeat)) {
    blockers.push({
      kind: "heartbeat",
      message: "heartbeat disabled — enable autonomy.heartbeat.enabled for unattended ticks",
    });
  }

  let queue = { queued: 0, running: 0, dead: 0 };
  try {
    queue = await queueStats(cfg);
  } catch {
    /* */
  }

  return {
    handsFree: blockers.length === 0 && (level === "lab" || level === "full" || level === "supervised"),
    level,
    principles: {
      groundHard: principles.groundHard,
      checkpointEveryTurns: principles.checkpointEveryTurns,
    },
    blockers,
    pendingApprovals: pendingApprovals.length,
    interruptedJobs: interrupted.slice(0, 10),
    pendingSkillProposals: pendingProposals.length,
    installGate,
    cost,
    heartbeatEnabled: hb.enabled === true,
    evolve: {
      autoResume: evolve.autoResume !== false,
      autoPromote: evolve.autoPromote === true,
      maxAutoResume: evolve.maxAutoResume ?? 2,
    },
    queue,
  };
}

/**
 * One evolution tick — safe to run from heartbeat or CLI.
 * 1. Status / blockers
 * 2. Optional auto-resume interrupted checkpoints (lab/full, policy on)
 * 3. Optional auto-promote skill proposals when install gate allows
 * 4. Log event
 */
export async function runEvolutionTick(cfg, opts = {}) {
  // Ensure background queue worker runs even without full gateway
  const status = await handsFreeStatus(cfg);
  const evolve = cfg.evolve || cfg.autonomy?.evolve || {};
  const actions = [];
  const level = status.level;

  try {
    if (evolve.queueWorker !== false) {
      startQueueWorker(cfg);
    }
  } catch (err) {
    actions.push({
      type: "queue_worker_error",
      code: "QUEUE_WORKER_START_FAILED",
      error: err?.message || String(err),
    });
  }

  // Auto-resume interrupted mid-run jobs (hands-free recovery)
  const autoResume =
    opts.autoResume ?? evolve.autoResume !== false;
  const maxResume = opts.maxAutoResume ?? evolve.maxAutoResume ?? 2;
  if (
    autoResume &&
    (level === "lab" || level === "full") &&
    status.blockers.every((b) => b.kind !== "budget" && b.kind !== "approval")
  ) {
    const candidates = (status.interruptedJobs || [])
      .filter((c) => c.id && c.status === "running")
      .slice(0, maxResume);
    for (const c of candidates) {
      if (opts.dryRun) {
        actions.push({ type: "resume", dryRun: true, id: c.id });
        continue;
      }
      try {
        const job = await resumeJobFromCheckpoint(cfg, c.id, {
          onEvent: opts.onEvent,
        });
        if (job.note && !job.resumed && job.resumed !== undefined) {
          actions.push({
            type: "resume_skipped",
            id: c.id,
            note: job.note,
            code: job.code || null,
            error: job.error || null,
          });
        } else if (job.code && job.pass === false && !job.recoveryKind && job.note) {
          actions.push({
            type: "resume_skipped",
            id: c.id,
            note: job.note,
            code: job.code,
            error: job.error || null,
          });
        } else {
          actions.push({
            type: job.pass === false && job.code === "CHECKPOINT_RESUME_AGENT_FAILED"
              ? "resume_error"
              : "resume",
            id: c.id,
            newId: job.id,
            pass: job.pass,
            recoveryKind: job.recoveryKind || null,
            code: job.code || null,
            error: job.error || null,
            note: job.note || null,
          });
        }
      } catch (err) {
        actions.push({
          type: "resume_error",
          id: c.id,
          code: err?.code || "RESUME_EXCEPTION",
          error: err?.message || String(err),
        });
      }
    }
  }

  // Auto-promote skills only when explicitly enabled AND install gate open
  const autoPromote =
    opts.autoPromote === true ||
    (evolve.autoPromote === true && (level === "lab" || level === "full"));
  if (autoPromote && status.installGate?.ok) {
    let proposals = [];
    try {
      proposals = await listProposals(cfg);
    } catch {
      proposals = [];
    }
    // S8 (Master Evolution Directive): promotion requires EVIDENCE. Only
    // proposals born from a VERIFIED success may auto-install; failure
    // drafts and unverified successes stay in the review queue (previously
    // the first N proposals were force-installed regardless of origin).
    const { readFile } = await import("node:fs/promises");
    const withEvidence = [];
    for (const p of proposals || []) {
      if (!(p.path || p.id)) continue;
      let fm = "";
      try {
        fm = String(await readFile(p.path, "utf8")).slice(0, 600);
      } catch {
        /* unreadable → no evidence */
      }
      if (/^source:\s*success$/m.test(fm) && /^sourceVerdict:\s*verified$/m.test(fm)) {
        withEvidence.push(p);
      } else {
        actions.push({
          type: "promote_skipped",
          path: p.path || p.id,
          reason: "unverified_evidence",
        });
      }
    }
    const toInstall = withEvidence.slice(0, opts.maxPromote ?? evolve.maxPromote ?? 3);
    for (const prop of toInstall) {
      const propPath = prop.path || prop;
      if (opts.dryRun) {
        actions.push({ type: "promote", dryRun: true, path: propPath });
        continue;
      }
      try {
        const installed = await installProposal(cfg, propPath, {
          force: true,
          ownerApproved: opts.ownerApproved === true,
        });
        actions.push({ type: "promote", path: propPath, ...installed });
      } catch (err) {
        actions.push({
          type: "promote_error",
          path: propPath,
          error: err?.message || String(err),
        });
      }
    }
  } else if (autoPromote && !status.installGate?.ok) {
    actions.push({
      type: "promote_blocked",
      reason: status.installGate?.reason || "install_gate",
      hint: status.installGate?.hint,
    });
  }

  // Checkpoint eviction (terminal / over maxCount / maxAge)
  try {
    const cpc = cfg.checkpoints || {};
    if (cpc.pruneOnTick !== false && !opts.dryRun) {
      const pr = await pruneCheckpoints(cfg, {
        dryRun: false,
        maxCount: cpc.maxCount,
        maxAgeMs: cpc.maxAgeMs,
      });
      if (pr.removed) actions.push({ type: "prune_checkpoints", ...pr });
    } else if (opts.dryRun && cpc.pruneOnTick !== false) {
      const pr = await pruneCheckpoints(cfg, { dryRun: true });
      actions.push({ type: "prune_checkpoints", ...pr });
    }
  } catch (err) {
    actions.push({ type: "prune_error", error: err?.message || String(err) });
  }

  const metrics = await readSkillLoopMetrics(cfg, 20).catch(() => []);

  const result = {
    at: new Date().toISOString(),
    status,
    actions,
    recentSkillMetrics: metrics.slice(0, 5),
  };

  if (!opts.dryRun) {
    await appendEvolveLog(cfg, {
      kind: "tick",
      handsFree: status.handsFree,
      level: status.level,
      actions: actions.map((a) => a.type),
      blockers: status.blockers.map((b) => b.kind),
    }).catch(() => {});
  }

  return result;
}

/**
 * Recommended config overlay for "owner hands-free" (still killable & inspectable).
 * Does not write disk — caller merges.
 */
export function handsFreeConfigOverlay() {
  return {
    profile: "lab", // prod stays supervised unless operator elevates
    autonomy: {
      level: "full",
      heartbeat: {
        enabled: true,
        everyMs: 30 * 60 * 1000,
        prompt:
          "Hands-free tick: check for interrupted jobs, skill proposals, and owner-assigned goals. Do not expand scope. Report blockers only.",
      },
      evolve: {
        autoResume: true,
        autoPromote: false, // require explicit enable — safer default
        maxAutoResume: 2,
      },
    },
    harness: {
      groundHard: true,
      checkpointEveryTurns: 2,
      groundingRetry: 1,
    },
    jobs: { groundHard: true },
    skills: {
      proposeOnFail: true,
      proposeOnSuccess: true,
      allowInstall: false, // owner must enable for true self-install
    },
    memory: { preferenceWriteBack: true },
  };
}

export default {
  handsFreeStatus,
  runEvolutionTick,
  handsFreeConfigOverlay,
};
