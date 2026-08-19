/**
 * Export + S3 put; cursor only advances after success.
 */
import { exportSiemBundle, readCursor, writeCursor } from "./audit-siem.mjs";
import { putS3WithRetry } from "./audit-s3.mjs";
import { acquireCursorLease, releaseCursorLease } from "./audit-cursor-lease.mjs";

export async function exportAndPutS3(cfg = {}, put, opts = {}) {
  const lease = acquireCursorLease(cfg, { owner: opts.owner || cfg?.cluster?.owner });
  if (!lease.ok) return { ok: false, skipped: true, ...lease };
  try {
    const before = readCursor(cfg);
    const bundle = exportSiemBundle(cfg, opts);
    if (!bundle.count) return { ok: true, skipped: true, bundle };
    const r = await putS3WithRetry(put, bundle, cfg);
    if (!r.ok) {
      writeCursor(cfg, before);
      return r;
    }
    return { ok: true, key: r.key, retries: r.retries, count: bundle.count };
  } finally {
    releaseCursorLease(cfg, { owner: opts.owner || cfg?.cluster?.owner || lease.owner });
  }
}

export default { exportAndPutS3 };
