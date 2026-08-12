/**
 * S3 — Safe worktree merge for swarm implement nodes.
 *
 * Flow:
 *  1. Collect implement (or worktree-bearing) node results
 *  2. Optional gates: verify passed, critic not blocking
 *  3. git apply --check for each worktree (serial)
 *  4. autoMerge (lab) → apply; else pending_approval + durable proposal
 *  5. approveMergeProposal(id) applies after owner approval
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  applyWorktreeMerge,
  mergeSubagentWorktree,
  worktreeDiff,
  removeWorktree,
  inspectRepoCleanliness,
} from "./worktree.mjs";
import {
  getSwarmRun,
  updateSwarmRun,
} from "./swarm-store.mjs";
import {
  evaluateReceiptPolicy,
  receiptsRequired,
  hasReceipt,
} from "./swarm-receipt.mjs";

function proposalsDir(cfg) {
  return path.join(
    cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw"),
    "swarms",
    "merge-proposals"
  );
}

async function ensureProposalDir(cfg) {
  await fs.mkdir(proposalsDir(cfg), { recursive: true });
}

/**
 * @param {object} cfg
 * @returns {{ autoMerge: boolean, requireVerify: boolean, requireCriticPass: boolean, cleanupWorktree: boolean }}
 */
export function resolveMergePolicy(cfg, input = {}) {
  const swarm = cfg?.swarm || {};
  const profile = cfg?.profile || "lab";
  // Explicit input wins; else swarm.autoMerge; else lab=true-ish only if flag set, prod=false
  let autoMerge =
    input.autoMerge != null
      ? Boolean(input.autoMerge)
      : swarm.autoMerge != null
        ? Boolean(swarm.autoMerge)
        : profile === "lab" || profile === "dev"
          ? Boolean(swarm.autoMergeLab ?? true) // lab: auto-merge implement worktrees by default
          : false;

  return {
    autoMerge,
    requireVerify: swarm.mergeRequireVerify !== false,
    requireCriticPass: swarm.mergeRequireCriticPass === true,
    cleanupWorktree: swarm.cleanupWorktreeAfterMerge === true,
    checkOnlyDefault: swarm.mergeCheckOnly === true,
    /** S4: refuse merge if main has unstaged or staged changes */
    requireCleanMain: swarm.mergeRequireCleanMain === true,
    /** S4: use git apply --index (stage results; stricter check) */
    useIndex: swarm.mergeUseIndex === true,
    /** S2: require receipts on implement/verify/critic ok nodes */
    requireReceipts:
      input.requireReceipts === true ||
      swarm.requireReceipts === true ||
      receiptsRequired(cfg, input),
  };
}

/**
 * Decide if graph gates allow merge.
 * @param {object[]} results — swarm node results
 * @param {object} policy
 */
export function evaluateMergeGates(results = [], policy = {}) {
  const byRole = {};
  for (const r of results) {
    const role = r.role || "research";
    if (!byRole[role]) byRole[role] = [];
    byRole[role].push(r);
  }

  const implement = (byRole.implement || []).filter((r) => r.ok);
  const verifyNodes = byRole.verify || [];
  const criticNodes = byRole.critic || [];

  const reasons = [];

  if (policy.requireVerify && verifyNodes.length) {
    const allVerifyOk = verifyNodes.every((r) => r.ok);
    if (!allVerifyOk) {
      reasons.push("verify node(s) failed or incomplete");
    }
  }

  if (policy.requireCriticPass && criticNodes.length) {
    const blocked = criticNodes.some((r) => {
      if (!r.ok) return true;
      const t = String(r.text || "").toLowerCase();
      return (
        /\b(block|blocking|do not merge|reject|critical risk)\b/.test(t) &&
        !/\bnot blocking\b/.test(t)
      );
    });
    if (blocked) reasons.push("critic indicated merge should be blocked");
  }

  // S2 receipt policy
  const receiptGate = evaluateReceiptPolicy(results, {
    require: policy.requireReceipts === true,
    criticalRoles: ["implement", "verify", "critic"],
  });
  if (!receiptGate.ok) {
    reasons.push(...receiptGate.reasons);
  }

  // Soft preference: note implement ok without receipt even when not required
  const implementNoReceipt = implement.filter((r) => !hasReceipt(r));
  if (implementNoReceipt.length && !policy.requireReceipts) {
    // soft — does not fail gate
  }

  return {
    ok: reasons.length === 0,
    reasons,
    implementCandidates: implement,
    receipts: receiptGate.summary,
    implementMissingReceipts: implementNoReceipt.map(
      (r) => r.nodeId || r.id
    ),
  };
}

/**
 * Build merge candidates from results (need workspace/worktree path).
 */
export function collectMergeCandidates(results = []) {
  const out = [];
  for (const r of results) {
    if (!r.ok) continue;
    // Already merged after implement wave (option A) — skip double-apply
    if (r.mergedToMain || (r.earlyMerge?.ok && !r.earlyMerge?.skipped)) continue;

    const role = String(r.role || "").toLowerCase();
    // P0: only implement nodes (or explicit merge:true) become candidates.
    // verify/research/observer workspaces are often the main tree and produce
    // false "corrupt patch" conflicts when diffed against themselves.
    const explicit = r.merge === true || r.result?.merge === true;
    if (role !== "implement" && !explicit) continue;

    const wt =
      r.workspace ||
      r.worktree?.path ||
      r.result?.worktree?.path ||
      r.result?.workspace;
    if (!wt) continue;
    out.push({
      nodeId: r.nodeId || r.id,
      childId: r.id,
      role: r.role,
      worktreePath: wt,
      result: r,
    });
  }
  return out;
}

/**
 * Run check (and optional apply) for each candidate serially.
 *
 * @returns {Promise<object>} merge report
 */
export async function planAndMaybeMerge(cfg, opts = {}) {
  const {
    swarmId,
    repoDir,
    results = [],
    input = {},
    onEvent,
  } = opts;

  const policy = resolveMergePolicy(cfg, input);
  const gates = evaluateMergeGates(results, policy);
  const candidates = collectMergeCandidates(results);

  const report = {
    swarmId: swarmId || null,
    policy,
    gates,
    candidates: candidates.map((c) => ({
      nodeId: c.nodeId,
      childId: c.childId,
      role: c.role,
      worktreePath: c.worktreePath,
    })),
    items: [],
    status: "noop",
    proposalId: null,
  };

  if (!candidates.length) {
    report.status = "noop";
    report.message = "no worktree candidates to merge";
    return report;
  }

  if (!gates.ok) {
    report.status = "blocked";
    report.message = gates.reasons.join("; ");
    onEvent?.({
      type: "swarm",
      phase: "merge_blocked",
      swarmId,
      reasons: gates.reasons,
    });
    return report;
  }

  const main = repoDir || process.cwd();

  // S4 — require clean main working tree + index
  if (policy.requireCleanMain) {
    const cleanliness = await inspectRepoCleanliness(main);
    report.mainCleanliness = cleanliness;
    if (!cleanliness.ok || !cleanliness.clean) {
      report.status = "blocked";
      report.message = cleanliness.error
        ? cleanliness.error
        : `main repo not clean (worktreeClean=${cleanliness.worktreeClean}, indexClean=${cleanliness.indexClean})`;
      onEvent?.({
        type: "swarm",
        phase: "merge_blocked",
        swarmId,
        reasons: [report.message],
        code: "MAIN_DIRTY",
      });
      return report;
    }
  }

  const itemResults = [];
  const applyOpts = { useIndex: Boolean(policy.useIndex) };

  for (const c of candidates) {
    onEvent?.({
      type: "swarm",
      phase: "merge_check",
      swarmId,
      nodeId: c.nodeId,
      worktreePath: c.worktreePath,
    });

    let diffMeta = null;
    try {
      diffMeta = await worktreeDiff(c.worktreePath);
    } catch (e) {
      diffMeta = { error: e.message, dirty: true };
    }

    const check = await applyWorktreeMerge(main, c.worktreePath, {
      checkOnly: true,
      ...applyOpts,
    });

    const item = {
      nodeId: c.nodeId,
      childId: c.childId,
      worktreePath: c.worktreePath,
      diffStat: diffMeta?.stat || null,
      dirty: diffMeta?.dirty ?? null,
      checkOk: Boolean(check.ok),
      checkMethod: check.method,
      checkError: check.error || null,
      code: check.code || null,
      conflicts: check.conflicts || [],
      patchPath: check.patchPath || null,
      applied: false,
      applyError: null,
    };

    if (!check.ok) {
      itemResults.push(item);
      onEvent?.({
        type: "swarm",
        phase: "merge_conflict",
        swarmId,
        nodeId: c.nodeId,
        error: check.error,
        code: check.code || null,
      });
      continue;
    }

    if (check.method === "noop" || check.method === "same-tree" || check.noop) {
      item.applied = false;
      item.noop = true;
      item.checkMethod = check.method;
      itemResults.push(item);
      continue;
    }

    // Clean check — apply only if autoMerge
    if (policy.autoMerge) {
      const apply = await applyWorktreeMerge(main, c.worktreePath, {
        checkOnly: false,
        ...applyOpts,
      });
      item.applied = Boolean(apply.ok);
      item.applyError = apply.error || null;
      item.code = apply.code || item.code;
      item.patchPath = apply.patchPath || item.patchPath;
      item.applyStat = apply.stat || null;
      if (apply.ok && policy.cleanupWorktree) {
        await removeWorktree(main, c.worktreePath).catch(() => {});
        item.worktreeRemoved = true;
      }
      onEvent?.({
        type: "swarm",
        phase: item.applied ? "merge_applied" : "merge_apply_failed",
        swarmId,
        nodeId: c.nodeId,
        error: item.applyError,
        code: item.code || null,
      });
    }

    itemResults.push(item);
  }

  report.items = itemResults;

  const anyConflict = itemResults.some((i) => !i.checkOk);
  const anyPending = itemResults.some(
    (i) => i.checkOk && !i.noop && !i.applied && !policy.autoMerge
  );
  const anyApplied = itemResults.some((i) => i.applied);
  const allNoop = itemResults.every((i) => i.noop || (!i.dirty && i.checkOk));

  if (anyConflict && !anyApplied) {
    report.status = "conflict";
    const codes = [...new Set(itemResults.filter((i) => !i.checkOk).map((i) => i.code).filter(Boolean))];
    report.codes = codes;
    report.message = codes.length
      ? `one or more merges failed (${codes.join(", ")})`
      : "one or more patches do not apply cleanly";
  } else if (anyPending) {
    report.status = "pending_approval";
    report.message = "patches check clean — awaiting owner approval";
    const proposal = await saveMergeProposal(cfg, {
      swarmId,
      repoDir: main,
      policy,
      items: itemResults.filter((i) => i.checkOk && !i.noop && !i.applied),
      gates,
    });
    report.proposalId = proposal.id;
    report.proposal = proposal;
    onEvent?.({
      type: "swarm",
      phase: "merge_pending_approval",
      swarmId,
      proposalId: proposal.id,
    });
  } else if (anyApplied) {
    report.status = anyConflict ? "partial" : "merged";
    report.message = anyConflict
      ? "some merges applied; some conflicts"
      : "all clean patches applied";
  } else if (allNoop) {
    report.status = "noop";
    report.message = "no file changes to merge";
  } else {
    report.status = "pending_approval";
    report.message = "merge not applied";
  }

  if (swarmId) {
    try {
      await updateSwarmRun(cfg, swarmId, {
        merge: {
          status: report.status,
          proposalId: report.proposalId,
          message: report.message,
          items: itemResults.map((i) => ({
            nodeId: i.nodeId,
            checkOk: i.checkOk,
            applied: i.applied,
            patchPath: i.patchPath,
            error: i.checkError || i.applyError,
          })),
          updatedAt: new Date().toISOString(),
        },
      });
    } catch (e) {
      console.warn("[xclaw:swarm-merge] persist:", e.message);
    }
  }

  return report;
}

export async function saveMergeProposal(cfg, data) {
  await ensureProposalDir(cfg);
  const id = randomUUID();
  const rec = {
    id,
    status: "pending",
    createdAt: new Date().toISOString(),
    swarmId: data.swarmId || null,
    repoDir: data.repoDir,
    policy: data.policy,
    gates: data.gates,
    items: data.items || [],
  };
  const fp = path.join(proposalsDir(cfg), `${id}.json`);
  await fs.writeFile(fp, JSON.stringify(rec, null, 2) + "\n");
  return rec;
}

export async function getMergeProposal(cfg, id) {
  try {
    const raw = await fs.readFile(
      path.join(proposalsDir(cfg), `${id}.json`),
      "utf8"
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function listMergeProposals(cfg, { status, limit = 30 } = {}) {
  await ensureProposalDir(cfg);
  let files = [];
  try {
    files = (await fs.readdir(proposalsDir(cfg))).filter((f) =>
      f.endsWith(".json")
    );
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const rec = JSON.parse(
        await fs.readFile(path.join(proposalsDir(cfg), f), "utf8")
      );
      if (status && rec.status !== status) continue;
      out.push(rec);
    } catch {
      /* */
    }
  }
  out.sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
  return out.slice(0, limit);
}

/**
 * Resolve and validate main repo path for merge.
 * @returns {{ ok: true, repoDir: string, tried?: string[] } | { ok: false, code, error, hints, tried?, repoDir? }}
 */
export async function resolveMergeRepoDir(rec, opts = {}) {
  const explicit = [opts.repoDir, rec?.repoDir].filter(
    (p) => p != null && String(p).trim() !== ""
  );
  const candidates =
    explicit.length > 0 ? explicit : [process.cwd()].filter((p) => p != null && String(p).trim() !== "");

  const tried = [];
  for (const raw of candidates) {
    const repoDir = path.resolve(String(raw));
    tried.push(repoDir);
    let st;
    try {
      st = await fs.stat(repoDir);
    } catch {
      if (explicit.length > 0) {
        return {
          ok: false,
          code: "REPO_MISSING",
          error: `repo path does not exist: ${repoDir}`,
          tried,
          hints: [
            "xclaw merge approve <id> --repo /path/to/git/root",
            "xclaw merge show <id>  # check repoDir",
          ],
        };
      }
      continue;
    }
    if (!st.isDirectory()) {
      return {
        ok: false,
        code: "REPO_NOT_DIRECTORY",
        error: `repo path exists but is not a directory: ${repoDir}`,
        repoDir,
        tried,
        hints: [
          "Pass --repo /path/to/git/root",
          "xclaw merge show <id>  # inspect repoDir field",
        ],
      };
    }
    return { ok: true, repoDir, tried };
  }

  return {
    ok: false,
    code: "REPO_MISSING",
    error:
      tried.length > 0
        ? `none of the candidate repo paths exist: ${tried.join(", ")}`
        : "no repoDir configured (proposal.repoDir empty and no --repo)",
    tried,
    hints: [
      "xclaw merge approve <id> --repo /path/to/git/root",
      "xclaw merge show <id>  # check repoDir",
      "Ensure the project was not deleted after the swarm run",
    ],
  };
}

/**
 * Diagnose why approve may fail (read-only).
 */
export async function diagnoseMergeProposal(cfg, proposalId, opts = {}) {
  const rec = await getMergeProposal(cfg, proposalId);
  if (!rec) {
    return {
      ok: false,
      code: "PROPOSAL_NOT_FOUND",
      error: "merge proposal not found",
      hints: [
        "xclaw merge list --status all",
        "Confirm ~/.xclaw/swarms/merge-proposals/ exists",
        "Use full id or unique 8-char prefix",
      ],
    };
  }

  const issues = [];
  const hints = [];

  const resolved = await resolveMergeRepoDir(rec, opts);
  if (!resolved.ok) {
    return {
      ok: false,
      proposalId: rec.id,
      status: rec.status,
      code: resolved.code,
      error: resolved.error,
      tried: resolved.tried,
      issues: [{ code: resolved.code, detail: resolved.error }],
      hints: resolved.hints || [],
      policy: rec.policy || {},
    };
  }
  const main = resolved.repoDir;

  if (rec.status !== "pending") {
    issues.push({
      code: "PROPOSAL_STATE",
      detail: `status=${rec.status} (approve only works on pending)`,
    });
    if (rec.status === "applied") {
      hints.push("Already applied — check git status / git diff on main");
    }
    if (rec.status === "rejected") {
      hints.push("Rejected earlier — create a new swarm run / proposal");
    }
  }

  const cleanliness = await inspectRepoCleanliness(main);
  const requireClean = Boolean(
    opts.requireCleanMain ?? rec.policy?.requireCleanMain
  );
  const useIndex = Boolean(opts.useIndex ?? rec.policy?.useIndex);

  if (!cleanliness.ok) {
    issues.push({
      code: "MAIN_NOT_GIT",
      detail: cleanliness.error || `repoDir not a git repo: ${main}`,
    });
    hints.push(`Pass --repo /path/to/git/root (cwd was ${process.cwd()})`);
  } else if (requireClean && !cleanliness.clean) {
    issues.push({
      code: "MAIN_DIRTY",
      detail: `worktreeClean=${cleanliness.worktreeClean} indexClean=${cleanliness.indexClean}`,
      porcelain: cleanliness.porcelain,
    });
    hints.push("git status");
    hints.push("git stash -u   # or commit local work");
  } else if (useIndex && !cleanliness.clean) {
    issues.push({
      code: "INDEX_MISMATCH_RISK",
      detail:
        "mergeUseIndex requires index≈worktree on touched paths; main is dirty",
      porcelain: cleanliness.porcelain,
    });
    hints.push("Clean main or disable mergeUseIndex");
  }

  const items = [];
  for (const item of rec.items || []) {
    const row = {
      nodeId: item.nodeId,
      worktreePath: item.worktreePath || null,
    };
    if (!item.worktreePath) {
      row.code = "MISSING_WORKTREE_PATH";
      issues.push({ code: row.code, nodeId: item.nodeId });
      hints.push("Proposal item missing worktreePath — swarm result incomplete");
      items.push(row);
      continue;
    }
    try {
      await fs.access(item.worktreePath);
      row.worktreeExists = true;
    } catch {
      row.worktreeExists = false;
      row.code = "WORKTREE_GONE";
      issues.push({
        code: "WORKTREE_GONE",
        nodeId: item.nodeId,
        path: item.worktreePath,
      });
      hints.push(
        `Worktree missing: ${item.worktreePath} — was it cleaned up? Re-run implement.`
      );
      items.push(row);
      continue;
    }

    const check = await applyWorktreeMerge(main, item.worktreePath, {
      checkOnly: true,
      useIndex,
    });
    row.checkOk = check.ok;
    row.checkMethod = check.method;
    row.checkError = check.error || null;
    row.patchPath = check.patchPath || null;
    if (!check.ok) {
      issues.push({
        code: "PATCH_CHECK_FAILED",
        nodeId: item.nodeId,
        error: check.error,
      });
      hints.push("Main may have drifted — git diff on main vs worktree");
      hints.push(
        check.patchPath
          ? `Inspect patch: ${check.patchPath}`
          : "No patch path (noop or early fail)"
      );
    }
    items.push(row);
  }

  if (!(rec.items || []).length) {
    issues.push({ code: "NO_ITEMS", detail: "proposal has zero items" });
    hints.push("Swarm produced no implement worktree candidates");
  }

  return {
    ok: issues.length === 0 && rec.status === "pending",
    proposalId: rec.id,
    status: rec.status,
    repoDir: main,
    policy: rec.policy || {},
    cleanliness,
    items,
    issues,
    hints: [...new Set(hints)],
  };
}

/**
 * Owner-approved apply of a pending merge proposal.
 *
 * `opts.principal` identifies who is approving: "operator" (CLI/gateway —
 * default) or "agent" (model-callable tool in the loop). Agents may NOT
 * approve merges — the agent that proposed a patch approving it next turn
 * voids the entire pending-approval model (design review P0 / brief 2.2).
 * Lab-only escape hatch: swarm.allowAgentMergeApprove: true (never in prod).
 */
export async function approveMergeProposal(cfg, proposalId, opts = {}) {
  const principal = String(opts.principal || "operator");
  if (principal !== "operator") {
    const labOverride =
      cfg?.swarm?.allowAgentMergeApprove === true &&
      String(cfg?.profile || "").toLowerCase() !== "prod";
    if (!labOverride) {
      return {
        ok: false,
        code: "PRINCIPAL_DENIED",
        error:
          "merge approval requires an operator (CLI `xclaw merge approve` or gateway) — agents cannot approve proposals",
        principal,
        hints: [
          `xclaw merge approve ${proposalId}`,
          "lab-only override: swarm.allowAgentMergeApprove: true",
        ],
      };
    }
  }
  const rec = await getMergeProposal(cfg, proposalId);
  if (!rec) {
    return {
      ok: false,
      code: "PROPOSAL_NOT_FOUND",
      error: "merge proposal not found",
      hints: ["xclaw merge list --status all", "xclaw merge doctor <id>"],
    };
  }
  if (rec.status === "applied") {
    return { ok: true, code: "ALREADY_APPLIED", status: "applied", proposalId };
  }
  if (rec.status === "rejected") {
    return { ok: false, code: "PROPOSAL_REJECTED", error: "proposal was rejected" };
  }
  if (rec.status !== "pending") {
    return {
      ok: false,
      code: "PROPOSAL_STATE",
      error: `cannot approve status=${rec.status}`,
    };
  }

  const resolved = await resolveMergeRepoDir(rec, opts);
  if (!resolved.ok) {
    return {
      ok: false,
      code: resolved.code || "REPO_MISSING",
      error: resolved.error,
      tried: resolved.tried,
      proposalId,
      hints: resolved.hints || [
        "xclaw merge approve <id> --repo /path/to/git/root",
      ],
    };
  }
  const main = resolved.repoDir;

  const useIndex =
    opts.useIndex != null
      ? Boolean(opts.useIndex)
      : Boolean(rec.policy?.useIndex);
  const requireClean =
    opts.requireCleanMain != null
      ? Boolean(opts.requireCleanMain)
      : Boolean(rec.policy?.requireCleanMain);

  // Always verify path is a git repo before apply
  const cleanliness = await inspectRepoCleanliness(main);
  if (!cleanliness.ok) {
    return {
      ok: false,
      code: "MAIN_NOT_GIT",
      error: cleanliness.error || `not a git repository: ${main}`,
      repoDir: main,
      proposalId,
      hints: [
        `git -C ${main} rev-parse --show-toplevel`,
        "Pass --repo to the repository root (not a subfolder without .git)",
        "xclaw merge doctor " + String(proposalId).slice(0, 8),
      ],
    };
  }

  if (requireClean && !cleanliness.clean) {
    return {
      ok: false,
      code: "MAIN_DIRTY",
      error: "main repo not clean; commit/stash before approve",
      cleanliness,
      repoDir: main,
      proposalId,
      hints: [
        `cd ${main} && git status`,
        "git stash -u",
        "xclaw merge doctor " + String(proposalId).slice(0, 8),
      ],
    };
  }

  const applied = [];
  const failed = [];
  const applyOpts = { useIndex };

  for (const item of rec.items || []) {
    if (!item.worktreePath) {
      failed.push({
        nodeId: item.nodeId,
        code: "MISSING_WORKTREE_PATH",
        error: "missing worktreePath",
      });
      continue;
    }
    try {
      await fs.access(item.worktreePath);
    } catch {
      failed.push({
        nodeId: item.nodeId,
        code: "WORKTREE_GONE",
        error: `worktree path does not exist: ${item.worktreePath}`,
        worktreePath: item.worktreePath,
      });
      continue;
    }
    // Re-check then apply
    const check = await applyWorktreeMerge(main, item.worktreePath, {
      checkOnly: true,
      ...applyOpts,
    });
    if (!check.ok) {
      failed.push({
        nodeId: item.nodeId,
        code: "PATCH_CHECK_FAILED",
        error: check.error || "check failed on approve",
        conflicts: check.conflicts,
        patchPath: check.patchPath,
      });
      continue;
    }
    if (check.method === "noop") {
      applied.push({ nodeId: item.nodeId, method: "noop" });
      continue;
    }
    const apply = await applyWorktreeMerge(main, item.worktreePath, {
      checkOnly: false,
      ...applyOpts,
    });
    if (apply.ok) {
      applied.push({
        nodeId: item.nodeId,
        method: apply.method,
        stat: apply.stat,
        patchPath: apply.patchPath,
      });
      if (opts.cleanupWorktree || rec.policy?.cleanupWorktree) {
        await removeWorktree(main, item.worktreePath).catch(() => {});
      }
    } else {
      failed.push({
        nodeId: item.nodeId,
        code: "APPLY_FAILED",
        error: apply.error || "apply failed",
        patchPath: apply.patchPath,
      });
    }
  }

  const status =
    failed.length === 0
      ? "applied"
      : applied.length === 0
        ? "failed"
        : "partial";

  rec.status = status === "failed" ? "failed" : status;
  rec.approvedAt = new Date().toISOString();
  rec.approveResult = { applied, failed };
  await ensureProposalDir(cfg);
  await fs.writeFile(
    path.join(proposalsDir(cfg), `${proposalId}.json`),
    JSON.stringify(rec, null, 2) + "\n"
  );

  // Optional git commit with XClaw Co-Authored-By trailers
  let commit = null;
  const wantCommit =
    opts.commit !== false &&
    opts.noCommit !== true &&
    cfg?.swarm?.commitAfterMerge !== false &&
    cfg?.git?.commitAfterMerge !== false;
  if (wantCommit && applied.length > 0 && failed.length === 0) {
    try {
      const { commitWithXclawTrailers, installXclawCommitHook } = await import(
        "../git/commit-trailers.mjs"
      );
      if (cfg?.git?.installCommitHook !== false) {
        await installXclawCommitHook(main, cfg).catch(() => {});
      }
      commit = await commitWithXclawTrailers(main, {
        cfg,
        all: true,
        subject:
          opts.commitSubject ||
          cfg?.swarm?.commitSubject ||
          `chore(swarm): merge proposal ${String(proposalId).slice(0, 8)}`,
        body:
          opts.commitBody ||
          `Swarm merge approved (${applied.length} item(s)).`,
      });
    } catch (e) {
      commit = {
        ok: false,
        error: e.message || String(e),
      };
    }
  }

  if (rec.swarmId) {
    await updateSwarmRun(cfg, rec.swarmId, {
      merge: {
        status: rec.status,
        proposalId,
        approvedAt: rec.approvedAt,
        applied: applied.length,
        failed: failed.length,
        commit: commit
          ? { ok: commit.ok, sha: commit.sha || null, skipped: commit.skipped }
          : null,
      },
    }).catch(() => {});
  }

  return {
    ok: failed.length === 0,
    status: rec.status,
    proposalId,
    applied,
    failed,
    commit,
  };
}

export async function rejectMergeProposal(cfg, proposalId, reason = "") {
  const rec = await getMergeProposal(cfg, proposalId);
  if (!rec) {
    return { ok: false, code: "PROPOSAL_NOT_FOUND", error: "merge proposal not found" };
  }
  if (rec.status === "applied") {
    return { ok: false, code: "ALREADY_APPLIED", error: "already applied" };
  }
  rec.status = "rejected";
  rec.rejectedAt = new Date().toISOString();
  rec.rejectReason = reason || null;
  await fs.writeFile(
    path.join(proposalsDir(cfg), `${proposalId}.json`),
    JSON.stringify(rec, null, 2) + "\n"
  );
  if (rec.swarmId) {
    await updateSwarmRun(cfg, rec.swarmId, {
      merge: { status: "rejected", proposalId, reason },
    }).catch(() => {});
  }
  return { ok: true, status: "rejected", proposalId };
}

/**
 * Tools for parent agent / owner.
 */
export function createMergeTools(ctx = {}) {
  return [
    {
      name: "xclaw_swarm_merge_approve",
      description:
        "Request approval of a pending swarm merge proposal. Approval is operator-gated: unless swarm.allowAgentMergeApprove is set (lab only), this returns PRINCIPAL_DENIED and the operator must run `xclaw merge approve <id>`.",
      parameters: {
        type: "object",
        properties: {
          proposalId: { type: "string" },
          cleanupWorktree: { type: "boolean" },
        },
        required: ["proposalId"],
      },
      async execute({ proposalId, cleanupWorktree }) {
        const out = await approveMergeProposal(ctx.cfg, proposalId, {
          cleanupWorktree,
          repoDir: ctx.workingDir,
          principal: "agent",
        });
        return {
          isError: !out.ok,
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        };
      },
    },
    {
      name: "xclaw_swarm_merge_reject",
      description: "Reject a pending swarm merge proposal without applying.",
      parameters: {
        type: "object",
        properties: {
          proposalId: { type: "string" },
          reason: { type: "string" },
        },
        required: ["proposalId"],
      },
      async execute({ proposalId, reason }) {
        const out = await rejectMergeProposal(ctx.cfg, proposalId, reason);
        return {
          isError: !out.ok,
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        };
      },
    },
    {
      name: "xclaw_swarm_merge_status",
      description: "List pending merge proposals or get one by id.",
      parameters: {
        type: "object",
        properties: {
          proposalId: { type: "string" },
          status: { type: "string" },
        },
      },
      async execute({ proposalId, status }) {
        if (proposalId) {
          const rec = await getMergeProposal(ctx.cfg, proposalId);
          if (!rec) {
            return {
              isError: true,
              content: [{ type: "text", text: "proposal not found" }],
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(rec, null, 2) }],
          };
        }
        const list = await listMergeProposals(ctx.cfg, {
          status: status || "pending",
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ count: list.length, proposals: list }, null, 2),
            },
          ],
        };
      },
    },
  ];
}

// re-export low-level for tests
export { applyWorktreeMerge, mergeSubagentWorktree };
