/**
 * Git worktree helpers for isolated subagents.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", (err) => resolve({ code: 1, stdout, stderr: err.message }));
  });
}

export async function isGitRepo(dir) {
  const r = await run("git", ["rev-parse", "--is-inside-work-tree"], dir);
  return r.code === 0 && r.stdout.trim() === "true";
}

/**
 * List remotes and validate URLs.
 * @returns {{ ok: boolean, remotes: object[], validation?: object, error?: string }}
 */
export async function listAndValidateRemotes(repoDir, opts = {}) {
  if (!(await isGitRepo(repoDir))) {
    return { ok: false, remotes: [], error: "not a git repository" };
  }
  const r = await run("git", ["remote", "-v"], repoDir);
  if (r.code !== 0) {
    return {
      ok: false,
      remotes: [],
      error: r.stderr || "git remote -v failed",
    };
  }
  const { parseGitRemoteV, validateGitRemotes } = await import(
    "../git/remote-url.mjs"
  );
  const remotes = parseGitRemoteV(r.stdout);
  // Dedupe by name+url for validation
  const unique = [];
  const seen = new Set();
  for (const row of remotes) {
    const k = `${row.name}|${row.url}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push({ name: row.name, url: row.url });
  }
  const validation = validateGitRemotes(unique, {
    allowHttp: opts.allowHttp === true,
    allowGitProtocol: opts.allowGitProtocol === true,
    allowFile: opts.allowFile !== false,
    allowedHosts: opts.allowedHosts || null,
  });
  return {
    ok: validation.ok,
    remotes,
    validation,
  };
}

/**
 * Create a linked worktree under os.tmpdir for branch work.
 * @returns {{ ok, path?, branch?, error? }}
 */
export async function createWorktree(repoDir, { branchPrefix = "xclaw", cfg } = {}) {
  if (!(await isGitRepo(repoDir))) {
    return { ok: false, error: "not a git repository" };
  }
  // Ensure agent commits in this repo get XClaw Co-Authored-By trailers
  try {
    const { installXclawCommitHook } = await import("../git/commit-trailers.mjs");
    await installXclawCommitHook(repoDir, cfg || {});
  } catch {
    /* non-fatal */
  }
  const id = randomUUID().slice(0, 8);
  const branch = `${branchPrefix}/${id}`;
  const dest = path.join(os.tmpdir(), `xclaw-wt-${id}`);
  const r = await run(
    "git",
    ["worktree", "add", "-b", branch, dest],
    repoDir
  );
  if (r.code !== 0) {
    // try without new branch (detached)
    const r2 = await run("git", ["worktree", "add", "--detach", dest], repoDir);
    if (r2.code !== 0) {
      return { ok: false, error: r.stderr || r2.stderr || "worktree add failed" };
    }
    return { ok: true, path: dest, branch: null, detached: true };
  }
  return { ok: true, path: dest, branch, detached: false };
}

export async function removeWorktree(repoDir, worktreePath) {
  const r = await run("git", ["worktree", "remove", "--force", worktreePath], repoDir);
  if (r.code !== 0) {
    try {
      await fs.rm(worktreePath, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
  return { ok: true };
}

/**
 * Diff worktree vs main repo HEAD for merge report.
 */
export async function worktreeDiff(worktreePath) {
  const r = await run("git", ["status", "--porcelain"], worktreePath);
  const r2 = await run("git", ["diff", "--stat"], worktreePath);
  const r3 = await run("git", ["diff"], worktreePath);
  return {
    porcelain: r.stdout.trim(),
    stat: r2.stdout.trim(),
    diff: r3.stdout.slice(0, 50_000),
    dirty: Boolean(r.stdout.trim()),
  };
}


/**
 * S4 — Inspect whether main repo is clean enough to merge.
 * @returns {{ ok: boolean, clean: boolean, worktreeClean: boolean, indexClean: boolean, porcelain?: string, error?: string }}
 */
export async function inspectRepoCleanliness(repoDir) {
  if (!(await isGitRepo(repoDir))) {
    return {
      ok: false,
      clean: false,
      worktreeClean: false,
      indexClean: false,
      error: "not a git repository",
    };
  }
  const wt = await run("git", ["diff", "--quiet"], repoDir);
  const idx = await run("git", ["diff", "--cached", "--quiet"], repoDir);
  const worktreeClean = wt.code === 0;
  const indexClean = idx.code === 0;
  const porcelain = await run("git", ["status", "--porcelain"], repoDir);
  return {
    ok: true,
    clean: worktreeClean && indexClean,
    worktreeClean,
    indexClean,
    porcelain: porcelain.stdout.trim() || "",
  };
}

/**
 * Apply worktree changes back to repo via git diff | git apply.
 * @param {{ checkOnly?: boolean, useIndex?: boolean }} [opts]
 *   useIndex: git apply --index (stages + requires index≈worktree)
 * @returns {{ ok, method, conflicts?, stat?, error?, patchPath? }}
 */
export async function applyWorktreeMerge(
  repoDir,
  worktreePath,
  { checkOnly = false, useIndex = false } = {}
) {
  if (!(await isGitRepo(repoDir))) {
    return { ok: false, error: "repoDir is not a git repository" };
  }
  if (!(await isGitRepo(worktreePath))) {
    return { ok: false, error: "worktreePath is not a git worktree" };
  }
  const diff = await run("git", ["diff", "HEAD"], worktreePath);
  if (!diff.stdout.trim()) {
    return { ok: true, method: "noop", stat: "no changes", conflicts: [] };
  }
  const patchPath = path.join(
    os.tmpdir(),
    `xclaw-merge-${randomUUID().slice(0, 8)}.patch`
  );
  await fs.writeFile(patchPath, diff.stdout);

  const checkArgs = useIndex
    ? ["apply", "--check", "--index", patchPath]
    : ["apply", "--check", patchPath];
  const check = await run("git", checkArgs, repoDir);
  if (check.code !== 0) {
    return {
      ok: false,
      method: useIndex ? "git-apply-index" : "git-apply",
      error: check.stderr || "patch does not apply cleanly",
      conflicts: [check.stderr || "conflict"],
      patchPath,
    };
  }
  if (checkOnly) {
    return {
      ok: true,
      method: useIndex ? "git-apply-index-check" : "git-apply-check",
      stat: "clean",
      patchPath,
    };
  }
  const applyArgs = useIndex
    ? ["apply", "--index", patchPath]
    : ["apply", patchPath];
  const apply = await run("git", applyArgs, repoDir);
  if (apply.code !== 0) {
    return {
      ok: false,
      method: useIndex ? "git-apply-index" : "git-apply",
      error: apply.stderr || "apply failed",
      conflicts: [apply.stderr],
      patchPath,
    };
  }
  const st = await run("git", ["status", "--porcelain"], repoDir);
  return {
    ok: true,
    method: useIndex ? "git-apply-index" : "git-apply",
    stat: st.stdout.trim() || "applied",
    conflicts: [],
    patchPath,
  };
}

/**
 * Merge subagent result worktree into parent workspace.
 */
export async function mergeSubagentWorktree(subagentRecord, repoDir, opts = {}) {
  const wtPath =
    subagentRecord?.result?.worktree?.path ||
    subagentRecord?.worktree?.path ||
    subagentRecord?.result?.workspace;
  if (!wtPath) return { ok: false, error: "no worktree path on subagent" };
  return applyWorktreeMerge(repoDir, wtPath, opts);
}
