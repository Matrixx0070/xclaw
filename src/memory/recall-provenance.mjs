/**
 * Expand compacted memory notes via sourceIds on demand.
 */
import { collectSourceIds } from "./compact-provenance.mjs";

export function indexById(store = []) {
  const map = new Map();
  for (const e of store) {
    if (e?.id) map.set(String(e.id), e);
  }
  return map;
}

export function expandProvenance(entry, store, opts = {}) {
  const maxDepth = opts.maxDepth ?? 2;
  const maxItems = opts.maxItems ?? 32;
  const index = store instanceof Map ? store : indexById(store);
  const seen = new Set();
  const found = [];
  const missing = [];

  function walk(ids, depth) {
    if (depth > maxDepth || found.length >= maxItems) return;
    for (const raw of ids) {
      const id = String(raw);
      if (seen.has(id)) continue;
      seen.add(id);
      const node = index.get(id);
      if (!node) {
        missing.push(id);
        continue;
      }
      found.push(node);
      if (found.length >= maxItems) return;
      const nested = collectSourceIds(node).filter((x) => x !== id);
      if (nested.length && depth < maxDepth) walk(nested, depth + 1);
    }
  }

  const roots = collectSourceIds(entry).filter((id) => id !== entry?.id);
  walk(roots, 1);
  return {
    entry,
    sources: found,
    missing,
    ok: missing.length === 0,
    sourceIds: roots,
  };
}

export function expandRecallHits(hits = [], store = [], opts = {}) {
  const index = indexById(store);
  return hits.map((hit) => {
    const ev = hit.ev || hit.entry || hit;
    const ids = ev.sourceIds || ev.meta?.sourceIds;
    if (!ids?.length) return { ...hit, provenance: null };
    const exp = expandProvenance(ev, index, opts);
    return { ...hit, provenance: exp };
  });
}

export default { indexById, expandProvenance, expandRecallHits };
