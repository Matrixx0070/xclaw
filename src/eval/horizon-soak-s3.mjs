/**
 * Idempotent S3 soak-audit sink with retry + injectable client.
 */
import { createHash } from "node:crypto";
import { exportSoakSiemBundle } from "./horizon-soak-siem.mjs";
import {
  acquireSiemCursorLease,
  releaseSiemCursorLease,
} from "./horizon-soak-siem-cursor.mjs";

const stats = {
  retry_total: 0,
  idempotent_hit: 0,
  sink_fail_total: 0,
  lastKey: null,
};

export function getSoakS3RetryTotal() {
  return stats.retry_total;
}
export function getSoakS3IdempotentHit() {
  return stats.idempotent_hit;
}
export function getSoakS3SinkFailTotal() {
  return stats.sink_fail_total;
}
export function lastSoakS3Key() {
  return stats.lastKey;
}
export function resetSoakS3Metrics() {
  stats.retry_total = 0;
  stats.idempotent_hit = 0;
  stats.sink_fail_total = 0;
  stats.lastKey = null;
}
export function renderSoakS3Metrics() {
  return (
    `xclaw_horizon_soak_s3_retry_total ${stats.retry_total}\n` +
    `xclaw_horizon_soak_s3_idempotent_hit ${stats.idempotent_hit}\n` +
    `xclaw_horizon_soak_s3_sink_fail_total ${stats.sink_fail_total}\n`
  );
}

export function soakS3Key({ from = "", to = "", events = [] } = {}) {
  const h = createHash("sha256");
  for (const e of events) {
    h.update(typeof e === "string" ? e : JSON.stringify(e));
    h.update("\n");
  }
  const sha = h.digest("hex").slice(0, 16);
  const f = String(from || "0").replace(/[^0-9A-Za-z:._-]/g, "_");
  const t = String(to || "0").replace(/[^0-9A-Za-z:._-]/g, "_");
  return `soak/${f}-${t}-${sha}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function putSoakSiemBundle(opts = {}) {
  const owner = opts.owner || `s3-${process.pid}`;
  const lease = acquireSiemCursorLease({
    base: opts.base,
    owner,
    ttlMs: opts.ttlMs ?? 15_000,
  });
  if (!lease.ok) {
    return { ok: false, code: lease.code, lease };
  }
  try {
    const bundle = await exportSoakSiemBundle(opts);
    const key = soakS3Key({
      from: bundle.header.from,
      to: bundle.header.to,
      events: bundle.events,
    });
    stats.lastKey = key;
    const client = opts.s3 || opts.client;
    if (!client || typeof client.putObject !== "function") {
      return {
        ok: true,
        mode: "dry",
        key,
        header: bundle.header,
        count: bundle.events.length,
      };
    }
    const maxAttempts = Number(opts.maxAttempts ?? 3);
    let lastErr = null;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        if (typeof client.headObject === "function") {
          const exists = await client.headObject(key);
          if (exists) {
            stats.idempotent_hit += 1;
            return {
              ok: true,
              hit: true,
              key,
              header: bundle.header,
              count: bundle.events.length,
            };
          }
        }
        await client.putObject(key, {
          header: bundle.header,
          events: bundle.events,
        });
        return {
          ok: true,
          hit: false,
          key,
          header: bundle.header,
          count: bundle.events.length,
        };
      } catch (e) {
        lastErr = e;
        stats.retry_total += 1;
        const backoff = Math.min(50 * 2 ** i, 400);
        if (i < maxAttempts - 1) await sleep(opts.backoffMs ?? backoff);
      }
    }
    stats.sink_fail_total += 1;
    return {
      ok: false,
      code: "SINK_FAIL",
      error: String(lastErr?.message || lastErr),
      key,
    };
  } finally {
    releaseSiemCursorLease({
      base: opts.base,
      owner,
      cursor: opts.cursor,
    });
  }
}

export default {
  soakS3Key,
  putSoakSiemBundle,
  renderSoakS3Metrics,
  resetSoakS3Metrics,
};
