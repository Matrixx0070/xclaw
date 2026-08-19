/**
 * Tool-result hash chain — per-turn tool outputs hashed for receipt/replay/audit.
 *
 * chain[i] = sha256( prevHash | entryCanonical )
 * tip = last hash (or GENESIS if empty)
 */
import crypto from "node:crypto";

export const HASH_CHAIN_VERSION = 1;
export const GENESIS_HASH = "0".repeat(64);

/**
 * Stable JSON for hashing (sorted keys, no undefined).
 * @param {unknown} value
 * @param {WeakSet<object>} [seen]
 */
export function stableStringify(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (seen.has(value)) return '"[Circular]"';
  // Track the ANCESTOR path, not every object ever visited. Keeping entries in
  // `seen` after returning made a value reachable twice from different branches
  // serialise as "[Circular]", so the canonical form no longer represented the
  // data it was hashing. (canonicalizeToolEntry builds fresh scalars, so no
  // existing chain tip changes — verified against every stored checkpoint.)
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((v) => stableStringify(v, seen)).join(",")}]`;
    }
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k], seen)}`)
      .join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

/**
 * Canonical payload for one tool-trace entry (excludes chain fields).
 * @param {object} entry
 */
export function canonicalizeToolEntry(entry = {}) {
  return {
    id: entry.id ?? null,
    toolCallId: entry.toolCallId ?? null,
    name: entry.name ?? null,
    status: entry.status ?? null,
    turn: entry.turn ?? null,
    startedAt: entry.startedAt ?? null,
    endedAt: entry.endedAt ?? null,
    argsSummary: entry.argsSummary ?? null,
    result: {
      text: entry.resultView?.text ?? (typeof entry.result === "string" ? entry.result : null),
      originalChars: entry.originalChars ?? entry.resultView?.originalChars ?? null,
      truncated: entry.truncated ?? entry.resultView?.truncated ?? false,
    },
    error: entry.error ?? null,
    blocked: entry.blocked ?? false,
  };
}

/**
 * @param {string} prevHash
 * @param {object} entry
 * @returns {string} hex sha256
 */
export function hashToolEntry(prevHash, entry) {
  const body = stableStringify({
    v: HASH_CHAIN_VERSION,
    prev: prevHash || GENESIS_HASH,
    entry: canonicalizeToolEntry(entry),
  });
  return crypto.createHash("sha256").update(body, "utf8").digest("hex");
}

/**
 * Stamp hash + prevHash onto a finalized tool-trace entry.
 * @param {object} entry
 * @param {string} [prevHash]
 * @returns {{ entry: object, hash: string, prevHash: string }}
 */
export function stampToolEntryHash(entry, prevHash = GENESIS_HASH) {
  const prev = prevHash || GENESIS_HASH;
  const hash = hashToolEntry(prev, entry);
  return {
    entry: { ...entry, hash, prevHash: prev, hashVersion: HASH_CHAIN_VERSION },
    hash,
    prevHash: prev,
  };
}

/**
 * Build / extend a hash chain over toolTrace entries.
 * @param {object[]} entries
 * @param {{ tip?: string }} [opts]
 * @returns {{ entries: object[], tip: string, genesis: string, version: number }}
 */
export function buildToolHashChain(entries = [], opts = {}) {
  let tip = opts.tip || GENESIS_HASH;
  const out = [];
  for (const e of entries) {
    const { entry, hash } = stampToolEntryHash(e, tip);
    out.push(entry);
    tip = hash;
  }
  return {
    entries: out,
    tip,
    genesis: GENESIS_HASH,
    version: HASH_CHAIN_VERSION,
  };
}

/**
 * Verify chain integrity.
 * @returns {{ ok: boolean, errors: string[], tip: string }}
 */
export function verifyToolHashChain(entries = []) {
  const errors = [];
  let tip = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e?.hash) {
      errors.push(`entry[${i}] missing hash`);
      continue;
    }
    const expectedPrev = tip;
    if (e.prevHash && e.prevHash !== expectedPrev) {
      errors.push(
        `entry[${i}] prevHash mismatch want=${expectedPrev.slice(0, 12)}… got=${String(e.prevHash).slice(0, 12)}…`
      );
    }
    const recomputed = hashToolEntry(expectedPrev, e);
    if (recomputed !== e.hash) {
      errors.push(`entry[${i}] hash mismatch (tamper or non-canonical fields)`);
    }
    tip = e.hash;
  }
  return { ok: errors.length === 0, errors, tip };
}

/**
 * Mutable chain accumulator for live agent loops.
 */
export function createToolHashChain() {
  let tip = GENESIS_HASH;
  const entries = [];
  return {
    get tip() {
      return tip;
    },
    get length() {
      return entries.length;
    },
    snapshot() {
      return {
        entries: [...entries],
        tip,
        genesis: GENESIS_HASH,
        version: HASH_CHAIN_VERSION,
      };
    },
    append(entry) {
      const stamped = stampToolEntryHash(entry, tip);
      entries.push(stamped.entry);
      tip = stamped.hash;
      return stamped.entry;
    },
    verify() {
      return verifyToolHashChain(entries);
    },
  };
}

export default {
  HASH_CHAIN_VERSION,
  GENESIS_HASH,
  stableStringify,
  canonicalizeToolEntry,
  hashToolEntry,
  stampToolEntryHash,
  buildToolHashChain,
  verifyToolHashChain,
  createToolHashChain,
};
