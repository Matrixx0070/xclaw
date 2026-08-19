/**
 * Select file vs Redis lease backend.
 */
import * as fileLease from "./ledger-lease.mjs";
import * as redisLease from "./ledger-lease-redis.mjs";

export function selectLeaseBackend(cfg = {}) {
  const backend =
    process.env.XCLAW_LEDGER_LEASE_BACKEND ||
    cfg?.tokens?.ledgerLeaseBackend ||
    "file";
  if (backend === "redis") return { name: "redis", api: redisLease };
  return { name: "file", api: fileLease };
}

export async function acquireLeaseViaBackend(cfg, opts) {
  const { name, api } = selectLeaseBackend(cfg);
  const r = api.acquireLease(cfg, opts);
  return Promise.resolve(r).then((x) => ({ ...x, backend: x.backend || name }));
}

export async function renewLeaseViaBackend(cfg, opts) {
  const { name, api } = selectLeaseBackend(cfg);
  const r = api.renewLease(cfg, opts);
  return Promise.resolve(r).then((x) => ({ ...x, backend: x.backend || name }));
}

export async function releaseLeaseViaBackend(cfg, opts) {
  const { name, api } = selectLeaseBackend(cfg);
  const r = api.releaseLease(cfg, opts);
  return Promise.resolve(r).then((x) => ({ ...x, backend: x.backend || name }));
}

export default {
  selectLeaseBackend,
  acquireLeaseViaBackend,
  renewLeaseViaBackend,
  releaseLeaseViaBackend,
};
