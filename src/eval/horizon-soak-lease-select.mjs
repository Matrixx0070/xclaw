/**
 * Select file vs redis soak lease backend.
 */
import {
  acquireSoakLease,
  renewSoakLease,
  releaseSoakLease,
} from "./horizon-soak-lease.mjs";
import {
  acquireSoakLeaseRedis,
  renewSoakLeaseRedis,
  releaseSoakLeaseRedis,
} from "./horizon-soak-lease-redis.mjs";

export function soakLeaseBackend(opts = {}) {
  const b = (
    opts.backend ||
    process.env.XCLAW_SOAK_LEASE_BACKEND ||
    "file"
  ).toLowerCase();
  return b === "redis" ? "redis" : "file";
}

export async function acquireSoakLeaseSelected(jobId, opts = {}) {
  if (soakLeaseBackend(opts) === "redis") {
    return acquireSoakLeaseRedis(jobId, opts);
  }
  return acquireSoakLease(jobId, opts);
}

export async function renewSoakLeaseSelected(jobId, opts = {}) {
  if (soakLeaseBackend(opts) === "redis") {
    return renewSoakLeaseRedis(jobId, opts);
  }
  return renewSoakLease(jobId, opts);
}

export async function releaseSoakLeaseSelected(jobId, opts = {}) {
  if (soakLeaseBackend(opts) === "redis") {
    return releaseSoakLeaseRedis(jobId, opts);
  }
  return releaseSoakLease(jobId, opts);
}

export default {
  soakLeaseBackend,
  acquireSoakLeaseSelected,
  renewSoakLeaseSelected,
  releaseSoakLeaseSelected,
};
