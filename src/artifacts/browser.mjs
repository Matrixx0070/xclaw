/**
 * Artifacts browser (P3.4) — workspace file lister for gateway UI/API.
 *
 * Walks only known artifact-ish roots under a workspace, with hard caps on
 * depth and file count so a large monorepo cannot DoS the gateway.
 *
 * Contract (tests + GET /artifacts/list):
 *   { root, count, files: [{ path, size, mtime }] }
 *
 * Paths in `files` are relative to `root`, POSIX-style.
 */

import fs from "node:fs/promises";
import path from "node:path";

/** Directory names (relative to workspace) that may contain operator artifacts. */
export const ARTIFACT_ROOTS = Object.freeze([
  "artifacts",
  "telegram-media",
  "discord-media",
  "slack-media",
  "imagine_images",
  "screenshots",
  "video_frames",
  "pdf",
  "audio",
]);

const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_FILES = 500;

/**
 * @typedef {object} ArtifactFile
 * @property {string} path   Relative path from workspace root (POSIX)
 * @property {number} size   Bytes
 * @property {string} mtime  ISO-8601 mtime
 */

/**
 * @typedef {object} ArtifactListing
 * @property {string} root
 * @property {number} count
 * @property {ArtifactFile[]} files
 */

/**
 * @param {string} rootDir
 * @param {{ maxDepth?: number, maxFiles?: number, roots?: string[] }} [opts]
 * @returns {Promise<ArtifactListing>}
 */
export async function listArtifacts(rootDir, opts = {}) {
  const root = path.resolve(rootDir || process.cwd());
  const maxDepth = clampInt(opts.maxDepth, 1, 16, DEFAULT_MAX_DEPTH);
  const maxFiles = clampInt(opts.maxFiles, 1, 10_000, DEFAULT_MAX_FILES);
  const roots = Array.isArray(opts.roots) && opts.roots.length
    ? opts.roots
    : ARTIFACT_ROOTS;

  /** @type {ArtifactFile[]} */
  const files = [];

  for (const name of roots) {
    if (files.length >= maxFiles) break;
    // Reject absolute / traversal names in the allow-list
    if (!name || path.isAbsolute(name) || name.includes("..") || name.includes("/") || name.includes("\\")) {
      continue;
    }
    const abs = path.join(root, name);
    try {
      const st = await fs.stat(abs);
      if (!st.isDirectory()) continue;
    } catch {
      continue; // missing root is normal
    }
    await walk(abs, root, 0, maxDepth, maxFiles, files);
  }

  files.sort((a, b) => {
    const ta = Date.parse(a.mtime) || 0;
    const tb = Date.parse(b.mtime) || 0;
    if (tb !== ta) return tb - ta;
    return a.path.localeCompare(b.path);
  });

  return {
    root,
    count: files.length,
    files,
  };
}

/**
 * Recursive directory walk with caps.
 * @param {string} absDir
 * @param {string} workspaceRoot
 * @param {number} depth
 * @param {number} maxDepth
 * @param {number} maxFiles
 * @param {ArtifactFile[]} out
 */
async function walk(absDir, workspaceRoot, depth, maxDepth, maxFiles, out) {
  if (out.length >= maxFiles || depth > maxDepth) return;

  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }

  // Stable order before mtime sort at the end
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const ent of entries) {
    if (out.length >= maxFiles) return;

    // Skip hidden / VCS noise inside artifact trees
    if (ent.name === "." || ent.name === ".." || ent.name.startsWith(".")) continue;

    const abs = path.join(absDir, ent.name);

    // Symlink safety: do not follow links (avoids escape / cycles)
    if (ent.isSymbolicLink()) continue;

    if (ent.isDirectory()) {
      if (depth + 1 > maxDepth) continue;
      await walk(abs, workspaceRoot, depth + 1, maxDepth, maxFiles, out);
      continue;
    }

    if (!ent.isFile()) continue;

    try {
      const st = await fs.stat(abs);
      if (!st.isFile()) continue;
      const rel = toPosix(path.relative(workspaceRoot, abs));
      if (!rel || rel.startsWith("..")) continue; // stay inside workspace
      out.push({
        path: rel,
        size: st.size,
        mtime: st.mtime.toISOString(),
      });
    } catch {
      // race: file deleted between readdir and stat
    }
  }
}

function toPosix(p) {
  return String(p || "").split(path.sep).join("/");
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export default listArtifacts;
