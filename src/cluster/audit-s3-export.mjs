/**
 * Export + S3 put; cursor only advances after success.
 */
import { exportSiemBundle, readCursor, writeCursor } from "./audit-siem.mjs";
import { putS3WithRetry } from "./audit-s3.mjs";

export async function exportAndPutS3(cfg = {}, put, opts = {}) {
  const before = readCursor(cfg);
  const bundle = exportSiemBundle(cfg, opts);
  if (!bundle.count) return { ok: true, skipped: true, bundle };
  const r = await putS3WithRetry(put, bundle, cfg);
  if (!r.ok) {
    writeCursor(cfg, before);
    return r;
  }
  return { ok: true, key: r.key, retries: r.retries, count: bundle.count };
}

export default { exportAndPutS3 };
