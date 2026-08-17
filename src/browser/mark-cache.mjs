/**
 * Feature 4 — Session-scoped set-of-marks cache for observe → click/type.
 *
 * Error codes:
 *   MARK_CACHE_EMPTY | MARK_UNKNOWN | MARK_STALE | MARK_NOT_VISIBLE
 *   STRUCTURE_PARSE_FAILED (soft, metadata)
 */

const DEFAULT_TTL_MS = 60_000;

/** @type {Map<string, { tabId?: string, url?: string, at: number, version: number, marks: Map<number, object> }>} */
const caches = new Map();

function key(sessionId, tabId) {
  return `${sessionId || "default"}::${tabId || "active"}`;
}

export function clearMarkCache(sessionId, tabId) {
  if (tabId === undefined) {
    // clear all tabs for session
    for (const k of [...caches.keys()]) {
      if (k.startsWith(`${sessionId || "default"}::`)) caches.delete(k);
    }
    return;
  }
  caches.delete(key(sessionId, tabId));
}

export function resetAllMarkCaches() {
  caches.clear();
}

/**
 * @param {string} sessionId
 * @param {object} structure — { url, nodes: [{ mark, bbox, ... }] }
 * @param {{ tabId?: string }} [opts]
 */
export function setMarksFromStructure(sessionId, structure, opts = {}) {
  const marks = new Map();
  const nodes = structure?.nodes || [];
  for (const n of nodes) {
    const mark = Number(n.mark);
    if (!Number.isFinite(mark) || mark <= 0) continue;
    const bbox = n.bbox;
    if (!bbox) continue;
    const w = Number(bbox.w) || 0;
    const h = Number(bbox.h) || 0;
    const cx = bbox.cx != null ? Number(bbox.cx) : Number(bbox.x) + w / 2;
    const cy = bbox.cy != null ? Number(bbox.cy) : Number(bbox.y) + h / 2;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    marks.set(mark, {
      mark,
      cx,
      cy,
      w,
      h,
      visible: w > 0 || h > 0,
      role: n.role,
      name: n.name,
      tag: n.tag,
    });
  }
  const prev = caches.get(key(sessionId, opts.tabId));
  const entry = {
    tabId: opts.tabId,
    url: structure?.url || null,
    at: Date.now(),
    version: (prev?.version || 0) + 1,
    marks,
  };
  caches.set(key(sessionId, opts.tabId), entry);
  return {
    ok: true,
    count: marks.size,
    version: entry.version,
    url: entry.url,
  };
}

/**
 * Resolve mark → coordinates.
 * @returns {{ ok: true, x, y, mark, meta } | { ok: false, code, message, validMarks?, mark? }}
 */
export function resolveMark(sessionId, mark, opts = {}) {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const m = Number(mark);
  if (!Number.isFinite(m) || m <= 0) {
    return { ok: false, code: "MARK_UNKNOWN", message: "mark must be a positive number", mark };
  }

  const entry = caches.get(key(sessionId, opts.tabId));
  if (!entry || entry.marks.size === 0) {
    return {
      ok: false,
      code: "MARK_CACHE_EMPTY",
      message: "No mark cache — call browser_observe / browser_snapshot first",
    };
  }

  if (Date.now() - entry.at > ttlMs) {
    return {
      ok: false,
      code: "MARK_STALE",
      message: `Mark cache older than ${ttlMs}ms — re-observe`,
      validMarks: [...entry.marks.keys()].sort((a, b) => a - b),
    };
  }

  if (opts.url && entry.url && opts.url !== entry.url) {
    return {
      ok: false,
      code: "MARK_STALE",
      message: "URL changed since observe — re-observe",
      validMarks: [...entry.marks.keys()].sort((a, b) => a - b),
    };
  }

  const hit = entry.marks.get(m);
  if (!hit) {
    return {
      ok: false,
      code: "MARK_UNKNOWN",
      message: `Unknown mark @${m}`,
      mark: m,
      validMarks: [...entry.marks.keys()].sort((a, b) => a - b),
    };
  }

  if (hit.visible === false || (hit.w === 0 && hit.h === 0)) {
    return {
      ok: false,
      code: "MARK_NOT_VISIBLE",
      message: `Mark @${m} has zero-size bbox`,
      mark: m,
      validMarks: [...entry.marks.keys()].sort((a, b) => a - b),
    };
  }

  return {
    ok: true,
    x: hit.cx,
    y: hit.cy,
    mark: m,
    meta: hit,
    url: entry.url,
    version: entry.version,
  };
}

export function getMarkCacheStats(sessionId, tabId) {
  const entry = caches.get(key(sessionId, tabId));
  if (!entry) return { empty: true, count: 0 };
  return {
    empty: false,
    count: entry.marks.size,
    url: entry.url,
    ageMs: Date.now() - entry.at,
    version: entry.version,
    marks: [...entry.marks.keys()].sort((a, b) => a - b),
  };
}

export default {
  setMarksFromStructure,
  resolveMark,
  clearMarkCache,
  resetAllMarkCaches,
  getMarkCacheStats,
};
