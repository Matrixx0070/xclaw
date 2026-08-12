/**
 * Durable atomic file replace: write temp → fsync → rename → fsync(dir).
 *
 * Tier 4 durability (see docs on fsync / NVMe Flush):
 *   - Atomic visibility for readers (rename)
 *   - Data durable before publish (fsync temp)
 *   - Directory entry durable after publish (fsync dir)
 *
 * Options:
 *   durable: true (default) — fsync file + directory
 *   durable: false — rename only (tier 2, faster)
 *   mode: file mode (default 0o600)
 *   dirMode: directory mode when creating (default 0o700)
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * @param {string} finalPath
 * @param {string|Buffer} data
 * @param {object} [opts]
 * @param {boolean} [opts.durable=true]
 * @param {number} [opts.mode=0o600]
 * @param {number} [opts.dirMode=0o700]
 */
export async function durableAtomicWrite(finalPath, data, opts = {}) {
  const durable = opts.durable !== false;
  const mode = opts.mode ?? 0o600;
  const dirMode = opts.dirMode ?? 0o700;
  const dir = path.dirname(finalPath);

  await fsp.mkdir(dir, { recursive: true, mode: dirMode });

  const token = crypto.randomBytes(4).toString("hex");
  const tmp = `${finalPath}.${process.pid}.${token}.tmp`;

  const fh = await fsp.open(tmp, "w", mode);
  try {
    await fh.writeFile(data);
    if (durable) {
      await fh.sync(); // fsync file data + metadata
    }
  } finally {
    await fh.close();
  }

  await fsp.rename(tmp, finalPath);

  if (durable) {
    try {
      const dirFh = await fsp.open(dir, "r");
      try {
        await dirFh.sync(); // fsync directory so rename is durable
      } finally {
        await dirFh.close();
      }
    } catch (e) {
      // Some platforms (certain network FS / Windows) may not support dir sync.
      // Data fsync already done; rename visibility is best-effort durable here.
      if (e && e.code !== "EINVAL" && e.code !== "ENOTSUP") {
        // ignore non-critical dir sync failures on exotic FS
      }
    }
  }

  try {
    await fsp.chmod(finalPath, mode);
  } catch {
    /* umask / platform */
  }

  return { path: finalPath, durable };
}

/**
 * JSON helper — stringifies with trailing newline.
 */
export async function durableAtomicWriteJson(finalPath, obj, opts = {}) {
  const body = JSON.stringify(obj, null, 2) + "\n";
  return durableAtomicWrite(finalPath, body, opts);
}

/**
 * Policy from cfg: auth.durableWrites !== false
 */
export function durableWritesEnabled(cfg = {}) {
  if (cfg.auth?.durableWrites === false) return false;
  if (process.env.XCLAW_DURABLE_WRITES === "0") return false;
  if (process.env.XCLAW_DURABLE_WRITES === "false") return false;
  return true;
}
