/**
 * Audit cursor lease — one exporter at a time.
 */
import {
  acquireCompactLease,
  releaseCompactLease,
  readLease,
} from "./compact-lease.mjs";

const REGION = "audit-cursor";
const held = { n: 0 };

export function acquireCursorLease(cfg = {}, opts = {}) {
  const r = acquireCompactLease(cfg, REGION, opts);
  if (r.ok) held.n += 1;
  return r;
}

export function releaseCursorLease(cfg = {}, opts = {}) {
  const r = releaseCompactLease(cfg, REGION, opts);
  if (r.ok && held.n > 0) held.n -= 1;
  return r;
}

export function readCursorLease(cfg = {}) {
  return readLease(cfg, REGION);
}

export function cursorLeasesHeld() {
  return held.n;
}

export default {
  acquireCursorLease,
  releaseCursorLease,
  readCursorLease,
  cursorLeasesHeld,
};
