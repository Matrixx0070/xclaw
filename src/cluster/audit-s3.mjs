/**
 * S3 audit put with decorrelated jitter retry.
 */
const stats = { s3_retry_total: 0, lastKey: null, lastRetries: 0 };

export function getS3RetryTotal() {
  return stats.s3_retry_total;
}

export function lastS3Meta() {
  return { key: stats.lastKey, retries: stats.lastRetries };
}

export function s3Key({ account = "default", to = 0 } = {}) {
  return `audit/${account}/${to}.json`;
}

export function nextSleep(prev, { min = 10, max = 200 } = {}) {
  const cap = Math.min(max, prev * 3);
  return min + Math.random() * Math.max(0, cap - min);
}

export async function putS3WithRetry(put, bundle, cfg = {}) {
  const maxAttempts = Number(cfg?.cluster?.s3Retries ?? 3);
  const account = cfg?.cluster?.auditAccount || "default";
  const to = bundle?.header?.to ?? 0;
  const key = s3Key({ account, to });
  let sleep = 20;
  let lastErr = null;
  let retries = 0;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await put({ key, bundle });
      stats.lastKey = key;
      stats.lastRetries = retries;
      return { ok: true, key, retries };
    } catch (e) {
      lastErr = e;
      retries += 1;
      stats.s3_retry_total += 1;
      if (i < maxAttempts - 1) {
        const ms = nextSleep(sleep, { min: 1, max: 5 });
        sleep = ms;
        await new Promise((r) => setTimeout(r, ms));
      }
    }
  }
  stats.lastKey = key;
  stats.lastRetries = retries;
  return {
    ok: false,
    code: "S3_PUT_FAILED",
    key,
    retries,
    error: String(lastErr?.message || lastErr),
  };
}

export default { putS3WithRetry, s3Key, getS3RetryTotal, lastS3Meta, nextSleep };
