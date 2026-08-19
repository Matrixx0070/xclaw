/**
 * Idempotent S3 keys: audit/{account}/{from}-{to}-{sha12}.json
 */
import { createHash } from "node:crypto";

const stats = { idempotent_hit: 0, lastKey: null };

export function getIdempotentHitTotal() {
  return stats.idempotent_hit;
}

export function lastIdempotentKey() {
  return stats.lastKey;
}

export function hashLines(lines = []) {
  const h = createHash("sha256");
  for (const line of lines) {
    h.update(typeof line === "string" ? line : JSON.stringify(line));
    h.update("\n");
  }
  return h.digest("hex").slice(0, 12);
}

export function idempotentS3Key({ account = "default", from = 0, to = 0, lines = [] } = {}) {
  const hash = hashLines(lines);
  return `audit/${account}/${from}-${to}-${hash}.json`;
}

export function noteIdempotentKey(key, { hit = false } = {}) {
  stats.lastKey = key;
  if (hit) stats.idempotent_hit += 1;
  return key;
}

export default {
  hashLines,
  idempotentS3Key,
  getIdempotentHitTotal,
  lastIdempotentKey,
  noteIdempotentKey,
};
