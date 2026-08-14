/**
 * Mission engine — takes a high-level engineering objective through
 * plan → change → verify → repair → prove, with durable state and recovery.
 *
 * Architecture:
 *  - ALL work happens in an isolated git worktree (the shadow workspace):
 *    the user's repo is untouched until an explicit, gated merge — which is
 *    also the rollback story (rollback = discard the worktree).
 *  - Every phase transition is persisted (missions/store.mjs); a crash or
 *    restart marks the mission interrupted and resumeMission() continues
 *    from the recorded phase in the surviving worktree.
 *  - Agent runs inside the worktree get autonomy WITHIN layered boundaries:
 *    sandbox pinned to the worktree, egress guards, lifecycle hooks (a
 *    system hook deny still blocks — autonomy never bypasses hooks), and
 *    the merge back to the real repo stays approval-gated.
 *  - Verification is evidence-first: detected (or configured) commands run
 *    in the worktree; failures feed a bounded repair loop; the mission can
 *    NEVER reach merge_ready without a passing verification run recorded.
 *  - Model routing per phase via cfg.missions.models {plan, execute, repair}.
 */
import path from "node:path";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { runAgentLoop } from "../agent/loop.mjs";
import {
  createWorktree,
  removeWorktree,
  worktreeDiff,
  isGitRepo,
  applyWorktreeMerge,
  partitionUntrackedByExcludes,
  untrackedPatch,
} from "../agents/worktree.mjs";
import { buildTaskContext } from "../intel/repo-intel.mjs";
import { createApprovalGate } from "../security/approvals.mjs";
import {
  newMission,
  saveMission,
  loadMission,
  addEvent,
  TERMINAL_STATUSES,
} from "./store.mjs";

const running = new Map(); // id -> {promise, abort}

function sh(cmd, cwd, timeoutMs = 300_000) {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", cmd], { cwd });
    let out = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output: out.slice(-20_000) });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 1, output: String(e.message) });
    });
  });
}

/** Detect the project's own verification commands (or use configured ones). */
export async function detectVerifyCommands(dir, configured) {
  if (Array.isArray(configured) && configured.length) return configured;
  const cmds = [];
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
    const scripts = pkg.scripts || {};
    if (scripts.lint) cmds.push("npm run lint --silent");
    if (scripts.build) cmds.push("npm run build --silent");
    if (scripts.test) cmds.push("npm test --silent");
    if (cmds.length) return cmds;
  } catch {
    /* not a node project */
  }
  try {
    await fs.access(path.join(dir, "pyproject.toml"));
    return ["python -m pytest -q"];
  } catch {}
  try {
    await fs.access(path.join(dir, "go.mod"));
    return ["go test ./..."];
  } catch {}
  try {
    await fs.access(path.join(dir, "Cargo.toml"));
    return ["cargo test --quiet"];
  } catch {}
  return []; // nothing detectable — verification will report "no checks"
}

/**
 * Code-work tool scope for mission agents. Missions run autoApprove inside
 * the worktree — but blanket auto-approval must not extend to tools with
 * side effects OUTSIDE the workspace (MCP servers, browser, image gen, …).
 * The allowlist keeps the autonomy story honest ("isolated shadow workspace")
 * and drops ~100 irrelevant tool schemas from every model turn.
 * Override via cfg.missions.allowTools (array), or `false` to disable.
 */
export const DEFAULT_MISSION_TOOLS = [
  "xclaw_bash",
  "xclaw_file_*",
  // engine-variant file tool names (thin/module engines)
  "file_*",
  "read_file",
  "write_file",
  "edit_file",
  "list_dir",
  // local code-navigation + reference lookup (SSRF-guarded web plane)
  "glob",
  "grep",
  "web_search",
  "web_fetch",
  "xclaw_web_search",
  "xclaw_web_fetch",
  "xclaw_skill",
  "xclaw_recall",
  "recall",
];

/**
 * Untracked paths that must never merge into the user's repo: ecosystem
 * artifacts created by verification (npm install) or the agent's own test
 * runs. Tracked files are unaffected (their changes ride the git patch).
 * Extend via cfg.missions.mergeExclude.
 */
const DEFAULT_MERGE_EXCLUDES = [
  "node_modules/**",
  "package-lock.json",
  "npm-debug.log*",
  ".venv/**",
  "__pycache__/**",
  ".pytest_cache/**",
];

export function missionMergeExcludes(cfg, mission) {
  const base = Array.isArray(cfg.missions?.mergeExclude)
    ? cfg.missions.mergeExclude
    : DEFAULT_MERGE_EXCLUDES;
  return [...base, ...(mission.verify?.artifacts || [])];
}

/** Mission-scoped cfg: full autonomy INSIDE the worktree, guards intact. */
export function missionCfg(cfg, worktreePath) {
  const allowTools =
    cfg.missions?.allowTools === false
      ? undefined
      : Array.isArray(cfg.missions?.allowTools)
        ? cfg.missions.allowTools
        : DEFAULT_MISSION_TOOLS;
  return {
    ...cfg,
    security: {
      ...(cfg.security || {}),
      autoApprove: true, // isolated shadow workspace — merge stays gated
    },
    sandbox: {
      ...(cfg.sandbox || {}),
      enabled: true,
      allowPaths: [worktreePath],
    },
    agent: {
      ...(cfg.agent || {}),
      maxTurns: cfg.missions?.maxTurnsPerPhase ?? 20,
      persistTranscript: false,
      ...(allowTools ? { allowTools } : {}),
    },
  };
}

/** Optional per-phase provider override (cfg.missions.models.{phase}). */
async function providerForPhase(cfg, phase) {
  const model = cfg.missions?.models?.[phase];
  if (!model) return undefined;
  try {
    const { resolveProviderRouteAsync } = await import("../providers/registry.mjs");
    const { createProvider } = await import("../agent/provider.mjs");
    const route = await resolveProviderRouteAsync(cfg, { model });
    const p = createProvider({
      apiKey: route.apiKey || cfg.agent?.apiKey,
      baseUrl: route.baseUrl,
      model: route.model || model,
      provider: route.provider,
      api: route.api,
      cfg,
    });
    p.providerName = route.provider;
    return p;
  } catch {
    return undefined; // fall back to the default resolution inside the loop
  }
}

async function agentPhase(cfg, mission, phase, message, { onEvent, signal, provider, providerOverride }) {
  const t0 = Date.now();
  const mcfg = missionCfg(cfg, mission.worktree.path);
  const out = await runAgentLoop({
    userMessage: message,
    cfg: mcfg,
    workingDir: mission.worktree.path,
    // The loop defaults to the process-wide shared approval gate, which a
    // live gateway primes with ITS security config (autoApprove:false) —
    // silently overriding the mission's declared worktree autonomy: every
    // exec tool pended for a human who was never asked, timed out, and the
    // stop skipped batch-mates (orphaned tool_use → provider 400). Missions
    // get their own gate built from the mission-scoped cfg; hooks still
    // compose (a hook "ask"/"deny" escalates through this gate unchanged).
    approvalGate: createApprovalGate(mcfg),
    signal,
    provider: providerOverride || provider || (await providerForPhase(cfg, phase)),
    chatSessionId: null,
    onEvent: (e) => {
      try {
        onEvent?.({ missionId: mission.id, phase, ...e });
      } catch {}
    },
  });
  mission.agentRuns.push({
    phase,
    turns: out.turns ?? null,
    ms: Date.now() - t0,
    at: new Date().toISOString(),
  });
  return out;
}

async function runVerification(cfg, mission) {
  const dir = mission.worktree.path;
  const commands = await detectVerifyCommands(dir, mission.verify.commands);
  mission.verify.commands = commands;
  // Snapshot untracked files BEFORE running anything: whatever verification
  // itself creates (npm install lockfiles, caches, …) is a verify artifact,
  // excluded from merge evidence and from the merge copy.
  let untrackedBefore = null;
  try {
    untrackedBefore = new Set((await worktreeDiff(dir)).untracked || []);
  } catch {}
  // node projects need deps in the fresh worktree
  try {
    await fs.access(path.join(dir, "package.json"));
    try {
      await fs.access(path.join(dir, "node_modules"));
    } catch {
      await sh("npm install --no-audit --no-fund --silent", dir, 300_000);
    }
  } catch {}
  const results = [];
  for (const cmd of commands) {
    const r = await sh(cmd, dir);
    results.push({ cmd, pass: r.code === 0, exitCode: r.code, output: r.output.slice(-6000) });
    if (r.code !== 0) break; // fail fast — the failure is the repair input
  }
  const ok = commands.length > 0 && results.every((r) => r.pass);
  if (untrackedBefore) {
    try {
      const after = (await worktreeDiff(dir)).untracked || [];
      const created = after.filter((rel) => !untrackedBefore.has(rel));
      mission.verify.artifacts = Array.from(
        new Set([...(mission.verify.artifacts || []), ...created])
      );
    } catch {}
  }
  mission.verify.results = results;
  mission.verify.history.push({
    at: new Date().toISOString(),
    attempt: mission.attempts,
    ok,
    summary: results.map((r) => `${r.pass ? "PASS" : "FAIL"} ${r.cmd}`).join(" · ") || "no checks detected",
  });
  return { ok, results, noChecks: commands.length === 0 };
}

/**
 * Evidence for the merge gate. Must show EVERYTHING the merge would do:
 * the tracked patch AND new (untracked) files — which applyWorktreeMerge
 * copies but `git diff <base>` never lists. Verify artifacts + configured
 * excludes are partitioned out (they will not merge) but recorded honestly.
 */
async function captureDiff(cfg, mission) {
  const d = await worktreeDiff(mission.worktree.path);
  const { kept: untracked, excluded } = partitionUntrackedByExcludes(
    d.untracked || [],
    missionMergeExcludes(cfg, mission)
  );
  let patch = String(d.diff || "");
  if (untracked.length) {
    try {
      const extra = await untrackedPatch(mission.worktree.path, untracked);
      if (extra) patch += (patch.endsWith("\n") || !patch ? "" : "\n") + extra;
    } catch {}
  }
  const trackedStat = (d.diffStat || d.stat || "").trim();
  mission.diff = {
    stat:
      trackedStat +
      (untracked.length ? `${trackedStat ? " · " : ""}${untracked.length} new file(s): ${untracked.slice(0, 20).join(", ")}` : ""),
    patch: patch.slice(0, 200_000),
    untracked,
    excludedUntracked: excluded,
    committedCount: d.committedCount ?? null,
  };
  return mission.diff;
}

/**
 * Create + start a mission. Returns the persisted record immediately;
 * execution continues in the background (track via store/events/WS).
 */
export async function startMission(cfg, opts = {}) {
  const { goal, repoDir } = opts;
  if (!goal || !String(goal).trim()) throw new Error("goal required");
  const repo = path.resolve(String(repoDir || process.cwd()));
  if (!(await isGitRepo(repo))) {
    throw new Error(`${repo} is not a git repository — missions need git for the shadow workspace + rollback`);
  }
  const mission = newMission({
    goal,
    repoDir: repo,
    maxAttempts: opts.maxAttempts ?? cfg.missions?.maxAttempts ?? 3,
    autoMerge: opts.autoMerge === true,
    verify: opts.verify || null,
  });
  addEvent(mission, "created", goal);
  await saveMission(cfg, mission);
  const controller = new AbortController();
  const promise = runMission(cfg, mission, {
    onEvent: opts.onEvent,
    signal: controller.signal,
    providerOverride: opts.provider,
  }).catch(async (err) => {
    // A rollback (or completion) may have set a terminal status while this
    // run was aborting — never overwrite it with "failed".
    const latest = (await loadMission(cfg, mission.id).catch(() => null)) || mission;
    if (TERMINAL_STATUSES.has(latest.status)) return;
    latest.status = "failed";
    latest.error = String(err?.message || err);
    addEvent(latest, "error", latest.error);
    await saveMission(cfg, latest).catch(() => {});
  });
  running.set(mission.id, { promise, abort: () => controller.abort() });
  promise.finally(() => running.delete(mission.id));
  return mission;
}

/** Resume an interrupted/failed mission from its recorded phase. */
export async function resumeMission(cfg, id, opts = {}) {
  const mission = await loadMission(cfg, id);
  if (!mission) throw new Error(`mission ${id} not found`);
  if (running.has(id)) throw new Error(`mission ${id} is already running`);
  if (["done", "rolled_back", "merging"].includes(mission.status)) {
    throw new Error(`mission ${id} is ${mission.status} — nothing to resume`);
  }
  // If the worktree vanished (reboot tmpdir cleanup), restart the work phases
  // but KEEP the mission history/attempts — recovery, not amnesia.
  let worktreeAlive = false;
  if (mission.worktree?.path) {
    try {
      await fs.access(mission.worktree.path);
      worktreeAlive = true;
    } catch {}
  }
  if (!worktreeAlive) {
    mission.worktree = null;
    addEvent(mission, "recovery", "worktree missing — recreating and re-running from plan");
    mission.status = "planning";
  } else {
    addEvent(mission, "recovery", `resuming from status ${mission.status}`);
    if (["interrupted", "failed"].includes(mission.status)) {
      // conservative: re-enter at verification — cheapest safe re-entry that
      // re-proves whatever state the worktree is actually in. "failed" MUST
      // be remapped too: a stale failed status would skip every phase block
      // in runMission and fall through to merge_ready with zero evidence.
      mission.status = mission.plan ? "verifying" : "planning";
    }
  }
  await saveMission(cfg, mission);
  const controller = new AbortController();
  const promise = runMission(cfg, mission, {
    onEvent: opts.onEvent,
    signal: controller.signal,
    providerOverride: opts.provider,
    resume: true,
  }).catch(async (err) => {
    // A rollback (or completion) may have set a terminal status while this
    // run was aborting — never overwrite it with "failed".
    const latest = (await loadMission(cfg, mission.id).catch(() => null)) || mission;
    if (TERMINAL_STATUSES.has(latest.status)) return;
    latest.status = "failed";
    latest.error = String(err?.message || err);
    addEvent(latest, "error", latest.error);
    await saveMission(cfg, latest).catch(() => {});
  });
  running.set(mission.id, { promise, abort: () => controller.abort() });
  promise.finally(() => running.delete(mission.id));
  return mission;
}

async function runMission(cfg, mission, { onEvent, signal, providerOverride } = {}) {
  const emit = (phase, note) => {
    addEvent(mission, phase, note);
    try {
      onEvent?.({ missionId: mission.id, type: "mission", phase, note });
    } catch {}
  };
  // Bail at any phase boundary if aborted (rollback) or if the mission has
  // already reached a terminal status on disk — a hanging provider call means
  // the abort signal can't interrupt mid-phase, so we re-check between phases
  // and let the terminal-safe outer catch handle the throw.
  const bailIfAborted = async () => {
    if (signal?.aborted) throw new Error("aborted");
    const latest = await loadMission(cfg, mission.id).catch(() => null);
    if (latest && TERMINAL_STATUSES.has(latest.status)) throw new Error("aborted");
  };

  // ── shadow workspace
  if (!mission.worktree) {
    const wt = await createWorktree(mission.repoDir, { branchPrefix: "mission", cfg });
    if (!wt.ok) throw new Error(`worktree: ${wt.error}`);
    mission.worktree = { path: wt.path, branch: wt.branch };
    emit("workspace", `shadow workspace ${wt.branch} at ${wt.path}`);
    await saveMission(cfg, mission);
  }

  // ── plan (repo intelligence → bounded plan run)
  if (!mission.plan) {
    mission.status = "planning";
    await saveMission(cfg, mission);
    const intel = await buildTaskContext(mission.worktree.path, mission.goal);
    emit("intel", `context: ${intel.files.length} ranked files of ${intel.stats.totalFiles} (${intel.stats.chars} chars)`);
    const planOut = await agentPhase(
      cfg,
      mission,
      "plan",
      [
        `You are planning an engineering mission in this repository (your working directory IS the repo).`,
        `MISSION: ${mission.goal}`,
        ``,
        intel.contextText,
        ``,
        `Produce a concrete implementation plan: which files change and why, what gets created, how it will be verified. Explore further with tools if the context above is not enough. Do NOT implement yet — reply with the plan only.`,
      ].join("\n"),
      { onEvent, signal, providerOverride }
    );
    await bailIfAborted();
    mission.plan = {
      summary: String(planOut.finalText ?? planOut.text ?? "").slice(0, 12_000),
      contextFiles: intel.files,
    };
    emit("plan", mission.plan.summary.slice(0, 300));
    await saveMission(cfg, mission);
  }

  // ── execute
  if (["planning", "executing"].includes(mission.status)) {
    mission.status = "executing";
    await saveMission(cfg, mission);
    emit("execute", "implementing the plan in the shadow workspace");
    await agentPhase(
      cfg,
      mission,
      "execute",
      [
        `Implement this mission in the current repository (your working directory). Work file-by-file, keep changes coherent across files.`,
        `MISSION: ${mission.goal}`,
        `PLAN:\n${mission.plan.summary}`,
        `When done, run the project's tests yourself if cheap; fix what you break. Reply with a summary of the changes you made.`,
      ].join("\n\n"),
      { onEvent, signal, providerOverride }
    );
    await bailIfAborted();
    mission.status = "verifying";
    await saveMission(cfg, mission);
  }

  // ── verify → repair loop
  while (["verifying", "repairing"].includes(mission.status)) {
    await bailIfAborted();
    emit("verify", `verification attempt ${mission.attempts + 1}/${mission.maxAttempts}`);
    const v = await runVerification(cfg, mission);
    await saveMission(cfg, mission);
    if (v.ok) {
      emit("verify", `PASSED: ${mission.verify.history.at(-1).summary}`);
      break;
    }
    if (v.noChecks) {
      emit("verify", "no verification commands detected/configured — cannot prove the change; marking failed (set verify commands to override)");
      mission.status = "failed";
      mission.error = "no verification commands available";
      await saveMission(cfg, mission);
      return mission;
    }
    mission.attempts += 1;
    if (mission.attempts >= mission.maxAttempts) {
      mission.status = "failed";
      mission.error = `verification failed after ${mission.attempts} attempts`;
      emit("verify", mission.error);
      await captureDiff(cfg, mission);
      await saveMission(cfg, mission);
      return mission;
    }
    mission.status = "repairing";
    await saveMission(cfg, mission);
    const failing = mission.verify.results.find((r) => !r.pass);
    emit("repair", `attempt ${mission.attempts}: ${failing?.cmd || "unknown check"} failed`);
    await agentPhase(
      cfg,
      mission,
      "repair",
      [
        `Verification failed in this repository. Investigate and FIX the root cause, then make the check pass. Do not weaken or delete tests to make them pass.`,
        `MISSION: ${mission.goal}`,
        `FAILING COMMAND: ${failing?.cmd}`,
        `OUTPUT:\n${failing?.output || "(none)"}`,
      ].join("\n\n"),
      { onEvent, signal, providerOverride }
    );
    await bailIfAborted();
    mission.status = "verifying";
    await saveMission(cfg, mission);
  }

  // ── evidence + gate
  // Structural invariant, not advisory: merge_ready REQUIRES a recorded
  // passing verification run, whatever path led here.
  if (!mission.verify?.history?.at(-1)?.ok) {
    mission.status = "failed";
    mission.error = "internal: reached gate without a passing verification run";
    addEvent(mission, "error", mission.error);
    await saveMission(cfg, mission);
    return mission;
  }
  await captureDiff(cfg, mission);
  mission.status = "merge_ready";
  emit("ready", `verified — diff ready (${(mission.diff.patch || "").length} chars of patch)`);
  await saveMission(cfg, mission);

  if (mission.autoMerge) {
    return mergeMission(cfg, mission.id, { onEvent });
  }
  return mission;
}

/** Apply the verified worktree changes to the real repo (the gated step). */
export async function mergeMission(cfg, id, { onEvent, checkOnly = false } = {}) {
  const mission = await loadMission(cfg, id);
  if (!mission) throw new Error(`mission ${id} not found`);
  if (mission.status !== "merge_ready") {
    throw new Error(`mission is ${mission.status} — only merge_ready missions merge (verification evidence required)`);
  }
  mission.status = "merging";
  await saveMission(cfg, mission);
  const out = await applyWorktreeMerge(mission.repoDir, mission.worktree.path, {
    checkOnly,
    // never carry verification/ecosystem artifacts into the user's repo
    excludeUntracked: missionMergeExcludes(cfg, mission),
  });
  if (checkOnly) {
    mission.status = "merge_ready";
    addEvent(mission, "merge", `check-only: ${out.ok ? "clean" : out.error || out.code}`);
    await saveMission(cfg, mission);
    return { mission, merge: out };
  }
  if (!out.ok) {
    mission.status = "merge_ready"; // stays recoverable — repo untouched or conflict-reported
    addEvent(mission, "merge", `merge failed: ${out.error || out.code}`);
    await saveMission(cfg, mission);
    return { mission, merge: out };
  }
  mission.status = "done";
  mission.mergedAt = new Date().toISOString();
  addEvent(mission, "merge", "merged into repository");
  await saveMission(cfg, mission);
  try {
    await removeWorktree(mission.repoDir, mission.worktree.path);
  } catch {}
  try {
    onEvent?.({ missionId: mission.id, type: "mission", phase: "done" });
  } catch {}
  return { mission, merge: out };
}

/** Discard everything — the repo was never touched. */
export async function rollbackMission(cfg, id) {
  const mission = await loadMission(cfg, id);
  if (!mission) throw new Error(`mission ${id} not found`);
  if (mission.status === "done") {
    throw new Error("mission already merged — revert via git in the repository");
  }
  // Persist the terminal status BEFORE aborting: the aborted run's error
  // handler reloads from disk and skips terminal statuses, so rolled_back must
  // be on disk first or the abort's "failed" would win the race.
  mission.status = "rolled_back";
  addEvent(mission, "rollback", "worktree discarded — repository untouched");
  await saveMission(cfg, mission);
  const active = running.get(id);
  if (active) {
    try { active.abort(); } catch {}
  }
  if (mission.worktree?.path) {
    try {
      await removeWorktree(mission.repoDir, mission.worktree.path);
    } catch {}
  }
  return mission;
}

export function missionRunning(id) {
  return running.has(id);
}
