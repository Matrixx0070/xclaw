/**
 * Git worktree helpers for isolated subagents.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
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
 * Parse `git status --porcelain` / `--porcelain=v1` lines for untracked paths.
 *
 * Git may C-quote paths when they contain spaces, tabs, quotes, or non-ASCII:
 *   ?? "dir with spaces/file.txt"
 *   ?? "quote\"file.txt"
 * Directory-only entries (default -unormal) end with `/`:
 *   ?? nested/
 * Prefer callers pass `-uall` for file-level untracked lists.
 *
 * @param {string} porcelain
 * @returns {string[]} relative paths (unquoted, trailing slash stripped for dirs)
 */
export function parsePorcelainUntracked(porcelain) {
  const out = [];
  const text = String(porcelain || "");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw;
    if (!line) continue;
    // v1 untracked: "?? path" (XY = ??)
    // ignore leading space variants; require ?? in first two columns
    if (line.length < 3) continue;
    const xy = line.slice(0, 2);
    if (xy !== "??") continue;
    // path starts after "?? " (third char should be space in standard porcelain)
    let pathPart = line.slice(2);
    if (pathPart.startsWith(" ")) pathPart = pathPart.slice(1);
    pathPart = pathPart.trim();
    if (!pathPart) continue;
    pathPart = unquoteGitCStylePath(pathPart);
    // normalize directory markers from -unormal
    if (pathPart.endsWith("/")) pathPart = pathPart.slice(0, -1);
    if (pathPart) out.push(pathPart);
  }
  return out;
}

/** Decode git C-quoted path: "foo\tbar" → foo\tbar */
export function unquoteGitCStylePath(s) {
  const t = String(s || "");
  if (t.length < 2 || t[0] !== '"' || t[t.length - 1] !== '"') {
    return t;
  }
  let out = "";
  for (let i = 1; i < t.length - 1; i++) {
    const c = t[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    i += 1;
    if (i >= t.length - 1) break;
    const n = t[i];
    const map = { n: "\n", t: "\t", r: "\r", a: "\a", b: "\b", v: "\v", f: "\f", '"': '"', "\\": "\\" };
    out += map[n] != null ? map[n] : n;
  }
  return out;
}

/**
 * Diff worktree vs the base it was created from, for the merge report.
 *
 * The child may COMMIT inside the worktree — `git diff HEAD` alone would then
 * be empty and the merge would silently NOOP, stranding committed work. The
 * patch is therefore taken against the merge-base of the worktree HEAD and the
 * main repo's HEAD (main HEAD discovered via --git-common-dir), which is the
 * worktree's creation point: committed AND uncommitted tracked changes both
 * surface in a single working-tree patch. Falls back to plain HEAD (previous
 * behavior) when base discovery fails; `opts.baseRef` overrides discovery.
 */
export async function worktreeDiff(worktreePath, { baseRef = null } = {}) {
  let base = baseRef ? String(baseRef) : null;
  let committedCount = 0;
  const wtHead = await run("git", ["rev-parse", "HEAD"], worktreePath);
  if (!base && wtHead.code === 0) {
    const common = await run(
      "git",
      ["rev-parse", "--git-common-dir"],
      worktreePath
    );
    if (common.code === 0 && common.stdout.trim()) {
      const commonDir = path.resolve(worktreePath, common.stdout.trim());
      const mainHead = await run(
        "git",
        ["--git-dir", commonDir, "rev-parse", "HEAD"],
        worktreePath
      );
      if (mainHead.code === 0 && mainHead.stdout.trim()) {
        const mb = await run(
          "git",
          ["merge-base", mainHead.stdout.trim(), wtHead.stdout.trim()],
          worktreePath
        );
        if (mb.code === 0 && mb.stdout.trim()) base = mb.stdout.trim();
      }
    }
  }
  const target = base || "HEAD";
  if (base && wtHead.code === 0) {
    const cnt = await run(
      "git",
      ["rev-list", "--count", `${base}..HEAD`],
      worktreePath
    );
    if (cnt.code === 0) committedCount = Number(cnt.stdout.trim()) || 0;
  }
  const r = await run("git", ["status", "--porcelain=v1"], worktreePath);
  const r2 = await run("git", ["diff", "--stat", target], worktreePath);
  const r3 = await run("git", ["diff", target], worktreePath);
  const porcelain = (r.stdout || "").trim();
  // -uall: list every untracked file (not only top-level dirs)
  const rU = await run(
    "git",
    ["status", "--porcelain=v1", "-uall"],
    worktreePath
  );
  const porcelainAll = (rU.stdout || "").trim() || porcelain;
  const untracked = parsePorcelainUntracked(porcelainAll);
  // dirty = carries changes relative to base (committed in the worktree counts)
  const dirty = Boolean(porcelain) || committedCount > 0;
  return {
    dirty,
    porcelain,
    untracked,
    base,
    committedCount,
    stat: (r2.stdout || "").trim() || (untracked.length ? `${untracked.length} untracked` : ""),
    diff: r3.stdout || "",
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

/** P1 — stable conflict / error codes for merge tooling */
export const MERGE_ERROR_CODES = Object.freeze({
  REPO_NOT_GIT: "REPO_NOT_GIT",
  WORKTREE_NOT_GIT: "WORKTREE_NOT_GIT",
  SAME_TREE: "SAME_TREE",
  NOOP: "NOOP",
  UNSAFE_PATH: "UNSAFE_PATH",
  COPY_EXISTS: "COPY_EXISTS",
  COPY_FAILED: "COPY_FAILED",
  PATCH_CORRUPT: "PATCH_CORRUPT",
  PATCH_REJECT: "PATCH_REJECT",
  PATCH_APPLY_FAILED: "PATCH_APPLY_FAILED",
  UNKNOWN: "UNKNOWN",
});

/**
 * Classify git apply stderr into a stable code.
 * @param {string} stderr
 * @returns {string}
 */
export function classifyPatchError(stderr = "") {
  const s = String(stderr || "").toLowerCase();
  if (!s.trim()) return MERGE_ERROR_CODES.PATCH_REJECT;
  if (/corrupt patch/.test(s)) return MERGE_ERROR_CODES.PATCH_CORRUPT;
  if (/does not exist in index|no such file|can't find file|already exists in working directory/.test(s)) {
    return MERGE_ERROR_CODES.PATCH_REJECT;
  }
  if (/patch does not apply|patch failed|hunks? failed|while searching for/.test(s)) {
    return MERGE_ERROR_CODES.PATCH_REJECT;
  }
  if (/error:|fatal:/.test(s)) return MERGE_ERROR_CODES.PATCH_APPLY_FAILED;
  return MERGE_ERROR_CODES.PATCH_REJECT;
}

/**
 * Classify a single copy-conflict message.
 * @param {string} msg
 * @returns {string}
 */
export function classifyCopyError(msg = "") {
  const s = String(msg || "").toLowerCase();
  if (/unsafe path/.test(s)) return MERGE_ERROR_CODES.UNSAFE_PATH;
  if (/eexist|already exists|file already exists|destination already exists/.test(s)) {
    return MERGE_ERROR_CODES.COPY_EXISTS;
  }
  if (/enoent|permission|eacces|eperm/.test(s)) return MERGE_ERROR_CODES.COPY_FAILED;
  return MERGE_ERROR_CODES.COPY_FAILED;
}

/**
 * Prefer strongest code among a list of copy conflict messages.
 */
export function classifyCopyConflicts(conflicts = []) {
  const codes = (conflicts || []).map(classifyCopyError);
  if (codes.includes(MERGE_ERROR_CODES.UNSAFE_PATH)) return MERGE_ERROR_CODES.UNSAFE_PATH;
  if (codes.includes(MERGE_ERROR_CODES.COPY_EXISTS)) return MERGE_ERROR_CODES.COPY_EXISTS;
  if (codes.length) return MERGE_ERROR_CODES.COPY_FAILED;
  return MERGE_ERROR_CODES.UNKNOWN;
}

/**
 * Walk up from `target` to the nearest EXISTING ancestor and assert it is
 * writable. Read-only probe for checkOnly merges (replaces the old mkdir call,
 * which mutated the repo during a dry run).
 */
async function assertWritableAncestor(target) {
  let dir = path.resolve(target);
  for (;;) {
    try {
      await fs.access(dir, fsConstants.W_OK);
      return;
    } catch (e) {
      if (e && e.code === "ENOENT") {
        const parent = path.dirname(dir);
        if (parent === dir) throw e; // hit filesystem root without finding one
        dir = parent;
        continue;
      }
      throw e;
    }
  }
}

/**
 * Match a repo-relative path against an exclude pattern.
 * Supported shapes: exact path, directory prefix ("dir" or "dir/**" both
 * cover the dir and everything under it), trailing-* name globs.
 */
export function matchesPathPattern(rel, pattern) {
  const r = String(rel || "");
  let p = String(pattern || "").trim();
  if (!r || !p) return false;
  if (p.endsWith("/**")) p = p.slice(0, -3);
  if (r === p) return true;
  if (r.startsWith(p + "/")) return true;
  if (p.endsWith("*") && !p.includes("/")) {
    // bare name glob (e.g. "npm-debug.log*") — match against basename
    const base = r.split("/").pop();
    return base.startsWith(p.slice(0, -1));
  }
  return false;
}

/** @returns {{ kept: string[], excluded: string[] }} */
export function partitionUntrackedByExcludes(untracked = [], excludes = []) {
  const kept = [];
  const excluded = [];
  for (const rel of untracked) {
    if (excludes.some((p) => matchesPathPattern(rel, p))) excluded.push(rel);
    else kept.push(rel);
  }
  return { kept, excluded };
}

/**
 * Synthesize git-style new-file patches for untracked files so diff evidence
 * can show their content (git diff <base> only covers tracked paths).
 * Uses `git diff --no-index /dev/null <file>` per file (exit 1 = has diff).
 */
export async function untrackedPatch(
  worktreePath,
  files = [],
  { maxPerFile = 40_000, maxTotal = 160_000 } = {}
) {
  let out = "";
  for (const rel of files) {
    if (out.length >= maxTotal) {
      out += `\n# … untracked patch truncated (${files.length} files total)\n`;
      break;
    }
    const r = await run(
      "git",
      ["diff", "--no-index", "--", "/dev/null", rel],
      worktreePath
    );
    // --no-index exits 1 when files differ (expected); >1 = real error
    if (r.code > 1) continue;
    let piece = r.stdout || "";
    if (piece.length > maxPerFile) {
      piece = piece.slice(0, maxPerFile) + `\n# … ${rel} truncated\n`;
    }
    out += piece;
  }
  return out;
}

export async function applyWorktreeMerge(
  repoDir,
  worktreePath,
  { checkOnly = false, useIndex = false, excludeUntracked = [] } = {}
) {
  if (!(await isGitRepo(repoDir))) {
    return {
      ok: false,
      code: MERGE_ERROR_CODES.REPO_NOT_GIT,
      error: "repoDir is not a git repository",
    };
  }
  if (!(await isGitRepo(worktreePath))) {
    return {
      ok: false,
      code: MERGE_ERROR_CODES.WORKTREE_NOT_GIT,
      error: "worktreePath is not a git worktree",
    };
  }

  // P0: never diff/apply a tree onto itself (false corrupt-patch conflicts)
  const mainResolved = path.resolve(repoDir);
  const wtResolved = path.resolve(worktreePath);
  if (mainResolved === wtResolved) {
    return {
      ok: true,
      code: MERGE_ERROR_CODES.SAME_TREE,
      method: "same-tree",
      stat: "worktreePath === repoDir — nothing to merge",
      conflicts: [],
      copied: [],
      noop: true,
    };
  }

  const meta = await worktreeDiff(worktreePath);
  const trackedDiff = (meta.diff || "").trim(); // emptiness signal only
  // The patch handed to `git apply` must keep its trailing newline — trimming
  // it makes the last hunk line "corrupt patch at line N".
  const patchText = trackedDiff
    ? meta.diff.endsWith("\n")
      ? meta.diff
      : meta.diff + "\n"
    : "";
  const allUntracked = Array.isArray(meta.untracked) ? meta.untracked : [];
  const { kept: untracked, excluded: excludedUntracked } =
    partitionUntrackedByExcludes(allUntracked, excludeUntracked);

  if (!trackedDiff && !untracked.length) {
    return {
      ok: true,
      code: MERGE_ERROR_CODES.NOOP,
      method: "noop",
      stat: excludedUntracked.length
        ? `no changes (${excludedUntracked.length} untracked excluded)`
        : "no changes",
      conflicts: [],
      copied: [],
      excluded: excludedUntracked,
    };
  }

  // --- TRANSACTIONAL ordering ---
  // 1. patch --check FIRST: a failing tracked patch must leave the repo
  //    byte-untouched (previously untracked copies landed before the patch
  //    failed — a partial merge the caller had to clean up).
  // 2. copy untracked WITHOUT overwriting: an existing destination is a
  //    conflict (identical content = idempotent re-merge, skipped silently).
  // 3. apply the patch; if it fails after a passing check (race), roll the
  //    copies back.
  let patchPath = null;
  if (trackedDiff) {
    patchPath = path.join(
      os.tmpdir(),
      `xclaw-merge-${randomUUID().slice(0, 8)}.patch`
    );
    await fs.writeFile(patchPath, patchText);
    const checkArgs = useIndex
      ? ["apply", "--check", "--index", patchPath]
      : ["apply", "--check", patchPath];
    const check = await run("git", checkArgs, repoDir);
    if (check.code !== 0) {
      const errText = check.stderr || "patch does not apply cleanly";
      return {
        ok: false,
        code: classifyPatchError(errText),
        method: useIndex ? "git-apply-index" : "git-apply",
        error: errText,
        conflicts: [errText],
        patchPath,
        copied: [],
        excluded: excludedUntracked,
      };
    }
  }

  // --- untracked / new files ---
  const copied = [];
  const copyConflicts = [];
  const createdPaths = []; // for rollback: paths that did NOT exist before us
  async function rollbackCopies() {
    for (const p2 of createdPaths.reverse()) {
      try {
        await fs.rm(p2, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }
  async function sameContent(a, b) {
    try {
      const [x, y] = await Promise.all([fs.readFile(a), fs.readFile(b)]);
      return x.equals(y);
    } catch {
      return false;
    }
  }
  for (const rel of untracked) {
    // skip nested git or absolute escapes
    if (!rel || rel.includes("..") || path.isAbsolute(rel)) {
      copyConflicts.push(`skip unsafe path: ${rel}`);
      continue;
    }
    const src2 = path.join(worktreePath, rel);
    const dest = path.join(repoDir, rel);
    try {
      const st = await fs.stat(src2);
      if (checkOnly) {
        // Pure dry-run: probe writability of the nearest existing ancestor —
        // NO filesystem writes of any kind on the checkOnly path.
        await assertWritableAncestor(st.isDirectory() ? dest : path.dirname(dest));
        copied.push(rel);
        continue;
      }
      let destExists = false;
      try {
        await fs.stat(dest);
        destExists = true;
      } catch {
        /* absent — normal case */
      }
      if (destExists) {
        if (!st.isDirectory() && (await sameContent(src2, dest))) {
          copied.push(rel); // idempotent re-merge of identical content
          continue;
        }
        copyConflicts.push(
          `${rel}: destination already exists (refusing to overwrite untracked data)`
        );
        continue;
      }
      if (st.isDirectory()) {
        await fs.cp(src2, dest, { recursive: true, force: false, errorOnExist: false });
      } else {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(src2, dest);
      }
      createdPaths.push(dest);
      copied.push(rel);
    } catch (e) {
      copyConflicts.push(`${rel}: ${e.message || e}`);
    }
  }
  if (copyConflicts.length && !checkOnly) {
    // transactional: any copy conflict aborts the merge and undoes our copies
    await rollbackCopies();
    return {
      ok: false,
      code: classifyCopyConflicts(copyConflicts),
      method: "copy-untracked",
      error: copyConflicts.join("; "),
      conflicts: copyConflicts,
      copied: [],
      rolledBack: true,
      patchPath,
      excluded: excludedUntracked,
    };
  }
  if (checkOnly) {
    if (copyConflicts.length && !trackedDiff) {
      return {
        ok: false,
        code: classifyCopyConflicts(copyConflicts),
        method: "copy-untracked-check",
        error: copyConflicts.join("; "),
        conflicts: copyConflicts,
        copied,
        excluded: excludedUntracked,
      };
    }
    return {
      ok: true,
      method: trackedDiff
        ? (useIndex ? "git-apply-index-check" : "git-apply-check")
        : "copy-untracked-check",
      stat: trackedDiff ? "clean" : `${copied.length} untracked to copy`,
      conflicts: copyConflicts,
      patchPath,
      copied,
      excluded: excludedUntracked,
    };
  }

  // --- tracked modifications via git apply (check already passed) ---
  if (trackedDiff) {
    const applyArgs = useIndex
      ? ["apply", "--index", patchPath]
      : ["apply", patchPath];
    const apply = await run("git", applyArgs, repoDir);
    if (apply.code !== 0) {
      const errText = apply.stderr || "apply failed";
      await rollbackCopies();
      return {
        ok: false,
        code: classifyPatchError(errText) === MERGE_ERROR_CODES.PATCH_REJECT
          ? MERGE_ERROR_CODES.PATCH_APPLY_FAILED
          : classifyPatchError(errText),
        method: useIndex ? "git-apply-index" : "git-apply",
        error: errText,
        conflicts: [errText],
        patchPath,
        copied: [],
        rolledBack: true,
        excluded: excludedUntracked,
      };
    }
  }

  const st = await run("git", ["status", "--porcelain"], repoDir);
  return {
    ok: true,
    method: trackedDiff
      ? (useIndex ? "git-apply-index+copy" : "git-apply+copy")
      : "copy-untracked",
    stat: st.stdout.trim() || `applied; copied=${copied.length}`,
    conflicts: copyConflicts,
    patchPath,
    copied,
    excluded: excludedUntracked,
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
