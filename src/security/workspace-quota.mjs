/**
 * Workspace disk + inode (file count) quotas.
 * Preflight before write tools; fail closed when over soft/hard caps.
 */
import fs from "node:fs/promises";
import path from "node:path";

/** Default hard caps (bytes / files). Override via cfg.workspace.quota. */
export const DEFAULT_QUOTA = Object.freeze({
  maxBytes: 512 * 1024 * 1024,
  maxFiles: 50_000,
  softBytesRatio: 0.85,
  softFilesRatio: 0.85,
  maxWalkEntries: 100_000,
});

export function resolveQuota(cfg = {}) {
  const q = cfg.workspace?.quota || cfg.quota || {};
  const maxBytes = Number(q.maxBytes) > 0 ? Number(q.maxBytes) : DEFAULT_QUOTA.maxBytes;
  const maxFiles = Number(q.maxFiles) > 0 ? Number(q.maxFiles) : DEFAULT_QUOTA.maxFiles;
  const softBytesRatio = Number(q.softBytesRatio) > 0 ? Number(q.softBytesRatio) : DEFAULT_QUOTA.softBytesRatio;
  const softFilesRatio = Number(q.softFilesRatio) > 0 ? Number(q.softFilesRatio) : DEFAULT_QUOTA.softFilesRatio;
  return {
    maxBytes,
    maxFiles,
    softBytes: Math.floor(maxBytes * softBytesRatio),
    softFiles: Math.floor(maxFiles * softFilesRatio),
    maxWalkEntries: Number(q.maxWalkEntries) > 0 ? Number(q.maxWalkEntries) : DEFAULT_QUOTA.maxWalkEntries,
    enabled: q.enabled !== false,
  };
}

export async function measureWorkspace(root, opts = {}) {
  const maxWalk = opts.maxWalkEntries || DEFAULT_QUOTA.maxWalkEntries;
  let bytes = 0;
  let files = 0;
  let truncated = false;
  const stack = [path.resolve(root)];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (files + stack.length > maxWalk) {
        truncated = true;
        return { bytes, files, truncated };
      }
      const fp = path.join(dir, ent.name);
      try {
        if (ent.isSymbolicLink()) continue;
        if (ent.isDirectory()) {
          stack.push(fp);
          continue;
        }
        if (ent.isFile()) {
          files += 1;
          try {
            const st = await fs.stat(fp);
            bytes += st.size || 0;
          } catch {
            /* */
          }
        }
      } catch {
        /* */
      }
    }
  }
  return { bytes, files, truncated };
}

export function evaluateQuota(usage, quota, delta = {}) {
  const bytes = (usage.bytes || 0) + (delta.extraBytes || 0);
  const files = (usage.files || 0) + (delta.extraFiles || 0);
  const overHardBytes = bytes > quota.maxBytes;
  const overHardFiles = files > quota.maxFiles;
  const overSoftBytes = bytes > quota.softBytes;
  const overSoftFiles = files > quota.softFiles;
  const hard = overHardBytes || overHardFiles;
  const soft = !hard && (overSoftBytes || overSoftFiles);
  const reasons = [];
  if (overHardBytes) reasons.push(`bytes ${bytes} > max ${quota.maxBytes}`);
  if (overHardFiles) reasons.push(`files ${files} > max ${quota.maxFiles}`);
  if (overSoftBytes) reasons.push(`bytes soft ${bytes} > ${quota.softBytes}`);
  if (overSoftFiles) reasons.push(`files soft ${files} > ${quota.softFiles}`);
  return { ok: !hard, hard, soft, bytes, files, reasons, quota };
}

export async function preflightWriteQuota(workspaceRoot, cfg = {}, delta = {}) {
  const quota = resolveQuota(cfg);
  if (!quota.enabled) return { ok: true, disabled: true };
  const root = path.resolve(workspaceRoot || process.cwd());
  let usage;
  try {
    usage = await measureWorkspace(root, { maxWalkEntries: quota.maxWalkEntries });
  } catch (e) {
    return {
      ok: false,
      hard: true,
      code: "QUOTA_MEASURE_FAILED",
      message: String(e?.message || e),
    };
  }
  const evaluation = evaluateQuota(usage, quota, delta);
  if (evaluation.hard) {
    return {
      ok: false,
      hard: true,
      code: "WORKSPACE_QUOTA_EXCEEDED",
      message: `workspace quota exceeded: ${evaluation.reasons.join("; ")}`,
      usage,
      evaluation,
    };
  }
  return {
    ok: true,
    soft: evaluation.soft,
    code: evaluation.soft ? "WORKSPACE_QUOTA_SOFT" : undefined,
    message: evaluation.soft ? evaluation.reasons.join("; ") : undefined,
    usage,
    evaluation,
  };
}

export function isWriteTool(name) {
  const n = String(name || "").toLowerCase();
  return /file_write|write_file|edit_file|append|mkdir|bash|shell|exec/.test(n);
}

export function estimateWriteDelta(name, args = {}) {
  const a = args || {};
  let extraBytes = 0;
  let extraFiles = 0;
  if (a.content != null) extraBytes += Buffer.byteLength(String(a.content), "utf8");
  if (a.text != null) extraBytes += Buffer.byteLength(String(a.text), "utf8");
  if (a.data != null) extraBytes += Buffer.byteLength(String(a.data), "utf8");
  if (/file_write|write_file|mkdir/.test(String(name || "").toLowerCase())) {
    extraFiles += 1;
  }
  return { extraBytes, extraFiles };
}

export default {
  DEFAULT_QUOTA,
  resolveQuota,
  measureWorkspace,
  evaluateQuota,
  preflightWriteQuota,
  isWriteTool,
  estimateWriteDelta,
};
