/**
 * Memory compaction with provenance — summaries keep source IDs; no silent drop.
 */
import crypto from "node:crypto";

export const COMPACT_SCHEMA_VERSION = 1;

export function collectSourceIds(entry) {
  const ids = [];
  if (entry?.id) ids.push(String(entry.id));
  if (Array.isArray(entry?.sourceIds)) {
    for (const s of entry.sourceIds) {
      if (s != null && s !== "") ids.push(String(s));
    }
  }
  if (Array.isArray(entry?.meta?.sourceIds)) {
    for (const s of entry.meta.sourceIds) {
      if (s != null && s !== "") ids.push(String(s));
    }
  }
  return [...new Set(ids)];
}

export function compactEntriesWithProvenance(entries = [], opts = {}) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const sourceIds = [];
  for (const e of list) {
    for (const id of collectSourceIds(e)) sourceIds.push(id);
  }
  const unique = [...new Set(sourceIds)];
  const texts = list.map((e) => String(e.text || e.content || "").trim()).filter(Boolean);
  const maxChars = opts.maxChars ?? 1200;
  let summary;
  if (typeof opts.summaryFn === "function") {
    summary = String(opts.summaryFn(texts) || "");
  } else {
    const bullets = texts.map((t) => `- ${t.slice(0, 200)}${t.length > 200 ? "…" : ""}`);
    summary = bullets.join("\n");
    if (summary.length > maxChars) {
      summary = summary.slice(0, maxChars - 20) + "\n…[compacted]";
    }
  }
  const id =
    (opts.idPrefix || "mem_c_") +
    crypto.createHash("sha256").update(unique.join("|") + summary).digest("hex").slice(0, 12);

  const entry = {
    id,
    text: summary,
    content: summary,
    sourceIds: unique,
    meta: {
      kind: "compaction",
      schemaVersion: COMPACT_SCHEMA_VERSION,
      inputCount: list.length,
      sourceIds: unique,
      compactedAt: new Date().toISOString(),
    },
  };

  return {
    entry,
    dropped: false,
    sourceIds: unique,
    inputCount: list.length,
  };
}

export function compactStoreIfNeeded(store = [], opts = {}) {
  const maxEntries = opts.maxEntries ?? 100;
  const batch = opts.compactBatch ?? 20;
  const list = Array.isArray(store) ? [...store] : [];
  if (list.length <= maxEntries) {
    return {
      store: list,
      compacted: null,
      report: { ok: true, compacted: false, size: list.length },
    };
  }
  const overflow = list.length - maxEntries + 1;
  const take = Math.min(Math.max(overflow, batch), list.length);
  const aged = list.slice(0, take);
  const rest = list.slice(take);
  const { entry, sourceIds, inputCount } = compactEntriesWithProvenance(aged, opts);
  const missing = aged
    .map((e) => e.id)
    .filter((id) => id && !sourceIds.includes(String(id)));
  if (missing.length) {
    throw new Error(`provenance gap: missing sourceIds ${missing.join(",")}`);
  }
  return {
    store: [entry, ...rest],
    compacted: entry,
    report: {
      ok: true,
      compacted: true,
      inputCount,
      sourceIds: sourceIds.length,
      size: rest.length + 1,
    },
  };
}

export function verifyProvenance(entry, expectedSourceIds = []) {
  const have = new Set(collectSourceIds(entry));
  const missing = expectedSourceIds.filter((id) => !have.has(String(id)));
  return {
    ok: missing.length === 0,
    missing,
    sourceIds: [...have],
  };
}

export default {
  COMPACT_SCHEMA_VERSION,
  collectSourceIds,
  compactEntriesWithProvenance,
  compactStoreIfNeeded,
  verifyProvenance,
};
