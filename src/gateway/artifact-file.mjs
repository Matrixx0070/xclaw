/**
 * Safe artifact file resolution for GET /artifacts/file?path=…
 *
 * The webchat UI renders agent-produced images (and small text artifacts)
 * inline. Serving files by request-supplied path is a classic traversal
 * footgun, so resolution is strict:
 *   - the resolved realpath must stay inside the workspace root;
 *   - only an extension allowlist is served (images + a few text types);
 *   - size-capped so a stray huge file can't be streamed out.
 */
import fs from "node:fs/promises";
import path from "node:path";

export const ARTIFACT_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".pdf": "application/pdf",
};

export const ARTIFACT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Resolve a requested artifact path against one or more allowed roots
 * (e.g. the webchat workspaces dir AND the agent working dir — sessions
 * and CLI runs write artifacts to different places).
 * @param {string|string[]} workspaceRoots
 * @returns {Promise<{ok: true, abs: string, mime: string, size: number} |
 *                   {ok: false, code: string, error: string}>}
 */
export async function resolveArtifactFile(workspaceRoots, requestedPath) {
  const roots = (Array.isArray(workspaceRoots) ? workspaceRoots : [workspaceRoots])
    .map((r) => path.resolve(String(r || "")))
    .filter((r) => r && r !== path.parse(r).root);
  if (!roots.length) {
    return { ok: false, code: "bad_root", error: "workspace root unavailable" };
  }
  const raw = String(requestedPath || "").trim();
  if (!raw) return { ok: false, code: "path_required", error: "path query required" };

  const ext = path.extname(raw).toLowerCase();
  const mime = ARTIFACT_MIME[ext];
  if (!mime) {
    return { ok: false, code: "type_not_allowed", error: `extension not served: ${ext || "(none)"}` };
  }

  let lastErr = { ok: false, code: "outside_workspace", error: "path escapes workspace" };
  for (const rootAbs of roots) {
    const abs = path.resolve(rootAbs, raw);
    // Containment BEFORE touching the filesystem (also covers ../ traversal)
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) continue;

    let real;
    try {
      real = await fs.realpath(abs);
    } catch {
      lastErr = { ok: false, code: "not_found", error: "file not found" };
      continue;
    }
    // Re-check containment on the REAL path (symlink escape)
    const rootReal = await fs.realpath(rootAbs).catch(() => rootAbs);
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
      lastErr = { ok: false, code: "outside_workspace", error: "path escapes workspace (symlink)" };
      continue;
    }

    const st = await fs.stat(real).catch(() => null);
    if (!st || !st.isFile()) {
      lastErr = { ok: false, code: "not_found", error: "not a file" };
      continue;
    }
    if (st.size > ARTIFACT_MAX_BYTES) {
      return { ok: false, code: "too_large", error: `file exceeds ${ARTIFACT_MAX_BYTES} bytes` };
    }
    return { ok: true, abs: real, mime, size: st.size };
  }
  return lastErr;
}

export default { resolveArtifactFile, ARTIFACT_MIME, ARTIFACT_MAX_BYTES };
