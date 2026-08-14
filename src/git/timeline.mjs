/**
 * Time-travel / state recovery (Mandate-2 slice A3) — git-only by design.
 *
 * Git already is the snapshot system: one commit per mission merge (with an
 * XClaw-Mission trailer) makes merges revertable, attributable and
 * anchorable. This module owns the refs and the joins:
 *   refs/xclaw/missions/<id>     — the merge commit of a mission
 *   refs/xclaw/known-good/<ts>   — operator/supervisor-blessed states
 *
 * Honest scope: anything committed is recoverable (deps via lockfiles +
 * npm ci). Operational state under ~/.xclaw, installed globals, services and
 * network/browser side effects are ATTRIBUTED (ledger effects) but not
 * undoable — revert reports them instead of pretending.
 */
import { spawn } from "node:child_process";

const KNOWN_GOOD_KEEP = 10;

function run(cmd, args, cwd, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: e.message });
    });
  });
}

export async function setMissionRef(repoDir, missionId, sha) {
  const r = await run("git", ["update-ref", `refs/xclaw/missions/${missionId}`, sha], repoDir);
  return { ok: r.code === 0, error: r.code === 0 ? null : r.stderr.trim() };
}

/** All xclaw states: mission merge refs + known-good marks, newest first. */
export async function listStates(repoDir) {
  const r = await run(
    "git",
    ["for-each-ref", "--sort=-creatordate", "--format=%(refname)%09%(objectname)%09%(creatordate:iso8601)%09%(subject)", "refs/xclaw/"],
    repoDir
  );
  if (r.code !== 0) return { ok: false, error: r.stderr.trim(), states: [] };
  const states = r.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref, sha, date, subject] = line.split("\t");
      const mission = ref.match(/^refs\/xclaw\/missions\/(.+)$/)?.[1] || null;
      const knownGood = ref.match(/^refs\/xclaw\/known-good\/(.+)$/)?.[1] || null;
      return { ref, sha, date, subject: subject || "", missionId: mission, knownGood };
    });
  return { ok: true, states };
}

/** Diff any two states (refs or shas). */
export async function diffStates(repoDir, refA, refB, { stat = true, patch = false } = {}) {
  const args = ["diff"];
  if (stat && !patch) args.push("--stat");
  args.push(`${refA}..${refB}`);
  const r = await run("git", args, repoDir, 30_000);
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() };
  return { ok: true, diff: r.stdout };
}

/**
 * Revert a mission's merge commit. Conflicts abort cleanly — no half-revert.
 * Returns the out-of-scope effects the caller should surface (ledger join is
 * the caller's job — this module stays git-pure).
 */
export async function revertMission(repoDir, missionId, { sha = null } = {}) {
  let target = sha;
  if (!target) {
    const r = await run("git", ["rev-parse", `refs/xclaw/missions/${missionId}`], repoDir);
    if (r.code !== 0) {
      return { ok: false, error: `no merge ref for mission ${missionId} (pre-A3 merge or never merged)` };
    }
    target = r.stdout.trim();
  }
  const st = await run("git", ["status", "--porcelain"], repoDir);
  if (st.stdout.trim()) {
    return { ok: false, error: "repo dirty — commit or stash before revert" };
  }
  const rv = await run("git", ["revert", "--no-edit", target], repoDir, 30_000);
  if (rv.code !== 0) {
    await run("git", ["revert", "--abort"], repoDir);
    return {
      ok: false,
      error: `revert conflicts — aborted cleanly: ${rv.stderr.trim().slice(0, 300)}`,
    };
  }
  const head = await run("git", ["rev-parse", "HEAD"], repoDir);
  return { ok: true, reverted: target, revertCommit: head.stdout.trim() };
}

/** Bless a state as known-good; keeps the newest N marks. */
export async function markKnownGood(repoDir, { sha = "HEAD", note = "" } = {}) {
  const resolved = await run("git", ["rev-parse", sha], repoDir);
  if (resolved.code !== 0) return { ok: false, error: resolved.stderr.trim() };
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const ref = `refs/xclaw/known-good/${ts}`;
  const r = await run("git", ["update-ref", ref, resolved.stdout.trim()], repoDir);
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() };
  // prune old marks
  const { states } = await listStates(repoDir);
  const marks = (states || []).filter((s) => s.knownGood).sort((a, b) => (a.knownGood < b.knownGood ? 1 : -1));
  for (const old of marks.slice(KNOWN_GOOD_KEEP)) {
    await run("git", ["update-ref", "-d", old.ref], repoDir);
  }
  return { ok: true, ref, sha: resolved.stdout.trim(), note };
}

export async function latestKnownGood(repoDir) {
  const { states } = await listStates(repoDir);
  const marks = (states || []).filter((s) => s.knownGood);
  return marks.length ? marks[0] : null;
}

/**
 * Which commits (and thus missions, via trailers) touched a path.
 * The ledger join (tool-level attribution) lives in ops/ledger.whoTouched —
 * this is the git half.
 */
export async function attribute(repoDir, relPath, { limit = 10 } = {}) {
  const r = await run(
    "git",
    ["log", `-${limit}`, "--format=%H%x09%ci%x09%s", "--", relPath],
    repoDir
  );
  if (r.code !== 0) return { ok: false, error: r.stderr.trim(), commits: [] };
  const commits = [];
  for (const line of r.stdout.split("\n").filter(Boolean)) {
    const [sha, date, subject] = line.split("\t");
    const body = await run("git", ["show", "-s", "--format=%B", sha], repoDir);
    const missionId = body.stdout.match(/^XClaw-Mission:\s*(\S+)/m)?.[1] || null;
    commits.push({ sha, date, subject, missionId });
  }
  return { ok: true, commits };
}
