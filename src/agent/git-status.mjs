/**
 * Lightweight git dirty detection for commit-chip path.
 * Sync-friendly with short timeout; never throws to callers.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

/**
 * @param {string} [cwd]
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=2500]
 */
export function inspectGitWorktree(cwd = process.cwd(), opts = {}) {
  const timeout = Math.max(200, Number(opts.timeoutMs) || 2500);
  const dir = path.resolve(cwd || process.cwd());

  try {
    if (!fs.existsSync(dir)) {
      return { ok: false, isRepo: false, dirty: false, reason: "cwd_missing" };
    }
  } catch {
    return { ok: false, isRepo: false, dirty: false, reason: "cwd_error" };
  }

  const run = (args) => {
    const r = spawnSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      timeout,
      maxBuffer: 512 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    return r;
  };

  const rev = run(["rev-parse", "--is-inside-work-tree"]);
  if (rev.status !== 0 || String(rev.stdout || "").trim() !== "true") {
    return { ok: true, isRepo: false, dirty: false, reason: "not_a_repo" };
  }

  // porcelain v1: any non-empty line ⇒ dirty
  const st = run(["status", "--porcelain=v1", "-uall"]);
  if (st.status !== 0) {
    return {
      ok: false,
      isRepo: true,
      dirty: false,
      reason: "status_failed",
      error: String(st.stderr || st.stdout || "").slice(0, 200),
    };
  }

  const lines = String(st.stdout || "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean);

  const files = lines.slice(0, 20).map((line) => {
    // XY PATH or XY ORIG -> PATH
    const rest = line.slice(3);
    const arrow = rest.indexOf(" -> ");
    const file = arrow >= 0 ? rest.slice(arrow + 4) : rest;
    return { code: line.slice(0, 2).trim(), path: file };
  });

  const branchR = run(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch =
    branchR.status === 0 ? String(branchR.stdout || "").trim() : null;

  return {
    ok: true,
    isRepo: true,
    dirty: lines.length > 0,
    branch: branch || null,
    files,
    fileCount: lines.length,
    samplePaths: files.map((f) => f.path).slice(0, 8),
  };
}

/**
 * Build commit message hint from paths.
 * @param {object} git
 * @param {object[]} [toolTrace]
 */
export function buildCommitChipPrompt(git, toolTrace = []) {
  const paths = new Set(git?.samplePaths || []);
  for (const e of toolTrace || []) {
    for (const a of e.artifacts || []) {
      if (a?.type === "file" && a.ref) paths.add(a.ref);
    }
    const p = e.args?.path || e.args?.file_path;
    if (p) paths.add(String(p));
  }
  const list = [...paths].slice(0, 8);
  const filePart = list.length
    ? ` Files touched: ${list.join(", ")}.`
    : "";
  return (
    "Create a concise git commit for the changes from this turn." +
    " Stage relevant files, write a short message (subject ≤ 72 chars)," +
    " and commit. Do not push unless I ask." +
    filePart
  );
}

export default { inspectGitWorktree, buildCommitChipPrompt };
