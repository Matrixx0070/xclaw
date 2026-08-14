/**
 * Operational ledger — the durable black box (Mandate-2 slice A1).
 *
 * Append-only JSONL of every tool execution, policy decision, verify result,
 * merge, phase transition, failure/recovery and deploy — with correlation ids
 * (sessionId/jobId/missionId/swarmId/nodeId/runId) so the operational graph
 * emerges from JOINS over the segments. Deliberately not a graph database.
 *
 * Envelope (one line each, target ≤ ~2KB):
 *   { v: 1, ts, kind, ids: {…}, actor, data: {…} }
 *
 * Storage: ~/.xclaw/ledger/YYYY-MM-DD.jsonl — day segmentation IS rotation.
 * Appends are best-effort and must never block or crash the agent loop.
 */
import fs from "fs/promises";
import fsSync from "node:fs";
import path from "path";
import { getConfigDir } from "../config/load.mjs";

export const LEDGER_KINDS = [
  "tool",
  "policy",
  "verify",
  "merge",
  "phase",
  "failure",
  "recovery",
  "deploy",
  "risk",
];

const DEFAULT_RETENTION_DAYS = 90;

export function ledgerDir(cfg = {}) {
  return (
    cfg.ledger?.dir || path.join(cfg.paths?.configDir || getConfigDir(), "ledger")
  );
}

function segmentName(ts) {
  return `${String(ts).slice(0, 10)}.jsonl`;
}

/**
 * Slim a finalized toolTrace entry for the ledger: outcomes and pointers,
 * never full result text (transcripts already hold it) and never raw args
 * (argsSummary is the durable form).
 */
export function slimToolTraceEntry(entry = {}, { effects } = {}) {
  return {
    id: entry.id,
    toolCallId: entry.toolCallId,
    name: entry.name,
    family: entry.nameNormalized,
    turn: entry.turn,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    durationMs: entry.durationMs,
    argsSummary: entry.argsSummary,
    status: entry.status,
    outcome: entry.outcome,
    artifacts: entry.artifacts?.length ? entry.artifacts : undefined,
    policy: entry.policy || undefined,
    error: entry.error || undefined,
    effects: effects?.length ? effects : undefined,
    resultChars: entry.result?.originalChars,
  };
}

/**
 * Create a ledger writer. Appends are fire-and-forget: failures are counted
 * (visible in stats()) but never thrown to the caller.
 * opts.ids — base correlation ids merged into every append.
 */
export function createLedger(cfg = {}, opts = {}) {
  // Write only when the config knows where home is: a fully-loaded config
  // (paths.configDir) or an explicit ledger.dir. Bare ad-hoc cfg objects
  // (unit tests, embedded callers) must never write into the real ~/.xclaw.
  const enabled =
    cfg.ledger?.enabled !== false &&
    Boolean(cfg.paths?.configDir || cfg.ledger?.dir);
  const dir = ledgerDir(cfg);
  const baseIds = opts.ids || {};
  let appendErrors = 0;
  let appended = 0;
  let mkdirDone = false;

  // Per-minute sampling cap applies ONLY to ok-status read-family tool
  // entries (swarm read storms); policy/failure/blocked entries are never
  // sampled away.
  const maxPerMin = Number(cfg.ledger?.maxPerMin || 0) || 0;
  let minuteKey = "";
  let minuteCount = 0;

  function sampledOut(evt) {
    if (!maxPerMin || evt.kind !== "tool") return false;
    const d = evt.data || {};
    if (d.status !== "ok" || d.policy || d.error) return false;
    if (!/read|list|glob|grep|search/.test(String(d.family || d.name || ""))) {
      return false;
    }
    const mk = evt.ts.slice(0, 16);
    if (mk !== minuteKey) {
      minuteKey = mk;
      minuteCount = 0;
    }
    minuteCount += 1;
    return minuteCount > maxPerMin;
  }

  async function write(evt) {
    if (!mkdirDone) {
      await fs.mkdir(dir, { recursive: true });
      mkdirDone = true;
    }
    const file = path.join(dir, segmentName(evt.ts));
    await fs.appendFile(file, JSON.stringify(evt) + "\n", "utf8");
  }

  function append({ kind, ids, actor = "agent", data = {} }) {
    if (!enabled) return;
    const evt = {
      v: 1,
      ts: new Date().toISOString(),
      kind,
      ids: pruneIds({ ...baseIds, ...ids }),
      actor,
      data,
    };
    if (sampledOut(evt)) return;
    write(evt)
      .then(() => {
        appended += 1;
      })
      .catch(() => {
        appendErrors += 1;
      });
  }

  return {
    enabled,
    dir,
    append,
    stats: () => ({ enabled, dir, appended, appendErrors }),
  };
}

function pruneIds(ids = {}) {
  const out = {};
  for (const [k, v] of Object.entries(ids)) {
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

let sharedLedger = null;
/** Process-wide writer for gateway-side emitters (approvals, routes). */
export function getSharedLedger(cfg = {}) {
  if (!sharedLedger) sharedLedger = createLedger(cfg);
  return sharedLedger;
}
export function resetSharedLedger() {
  sharedLedger = null;
}

async function listSegments(dir) {
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
    .sort();
}

function sinceToDate(since) {
  if (!since) return null;
  const m = String(since).match(/^(\d+)([dhm])$/);
  if (m) {
    const n = Number(m[1]);
    const ms = m[2] === "d" ? n * 86400_000 : m[2] === "h" ? n * 3600_000 : n * 60_000;
    return new Date(Date.now() - ms);
  }
  const d = new Date(since);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Streamed join over day segments. Filters: since ("2d"/"12h"/ISO), until,
 * kind, status, any correlation id (sessionId/jobId/missionId/swarmId/nodeId/
 * runId), artifact path substring. Returns newest-last, capped at limit
 * (default 200, newest kept).
 */
export async function queryLedger(cfg = {}, filters = {}) {
  const dir = ledgerDir(cfg);
  const limit = Math.max(1, Math.min(5000, Number(filters.limit || 200)));
  const since = sinceToDate(filters.since);
  const until = filters.until ? new Date(filters.until) : null;
  const idFilters = {};
  for (const k of ["sessionId", "jobId", "missionId", "swarmId", "nodeId", "runId"]) {
    if (filters[k]) idFilters[k] = String(filters[k]);
  }
  const kinds = filters.kind
    ? String(filters.kind).split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const segments = await listSegments(dir);
  const minSeg = since ? segmentName(since.toISOString()) : null;
  const maxSeg = until ? segmentName(until.toISOString()) : null;

  const out = [];
  let malformed = 0;
  for (const seg of segments) {
    if (minSeg && seg < minSeg) continue;
    if (maxSeg && seg > maxSeg) continue;
    let text;
    try {
      text = await fs.readFile(path.join(dir, seg), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        malformed += 1;
        continue;
      }
      if (since && evt.ts < since.toISOString()) continue;
      if (until && evt.ts > until.toISOString()) continue;
      if (kinds && !kinds.includes(evt.kind)) continue;
      if (filters.status && evt.data?.status !== filters.status) continue;
      let idOk = true;
      for (const [k, v] of Object.entries(idFilters)) {
        if (String(evt.ids?.[k] || "") !== v) {
          idOk = false;
          break;
        }
      }
      if (!idOk) continue;
      if (filters.artifact) {
        const needle = String(filters.artifact);
        const arts = evt.data?.artifacts || [];
        const files = evt.data?.files || [];
        const hit =
          arts.some((a) => String(a.ref || a.path || "").includes(needle)) ||
          files.some((f) => String(f).includes(needle));
        if (!hit) continue;
      }
      out.push(evt);
      if (out.length > limit) out.shift(); // keep newest
    }
  }
  return { events: out, malformed };
}

/**
 * "Who touched this path" — the flagship join: scans tool artifacts and
 * merge file lists, returns the chain of (mission/swarm/session, tool)
 * that wrote it, newest last.
 */
export async function whoTouched(cfg = {}, target, { since = "30d", limit = 50 } = {}) {
  const { events } = await queryLedger(cfg, {
    since,
    artifact: target,
    limit: 5000,
  });
  const hits = [];
  for (const evt of events) {
    if (evt.kind === "tool") {
      const writes = (evt.data?.artifacts || []).filter(
        (a) => String(a.ref || a.path || "").includes(target)
      );
      if (!writes.length) continue;
      if (!/write|edit|shell|exec|bash/.test(String(evt.data?.family || evt.data?.name || ""))) {
        continue;
      }
      hits.push({
        ts: evt.ts,
        via: evt.data?.name,
        status: evt.data?.status,
        ids: evt.ids,
      });
    } else if (evt.kind === "merge") {
      const files = evt.data?.files || [];
      if (!files.some((f) => String(f).includes(target))) continue;
      hits.push({ ts: evt.ts, via: "merge", commit: evt.data?.commit || null, ids: evt.ids });
    }
  }
  return hits.slice(-limit);
}

export async function ledgerStats(cfg = {}) {
  const dir = ledgerDir(cfg);
  const segments = await listSegments(dir);
  let bytes = 0;
  for (const seg of segments) {
    try {
      bytes += fsSync.statSync(path.join(dir, seg)).size;
    } catch {
      /* segment may vanish under compaction */
    }
  }
  return {
    dir,
    segments: segments.length,
    firstDay: segments[0]?.slice(0, 10) || null,
    lastDay: segments[segments.length - 1]?.slice(0, 10) || null,
    bytes,
  };
}

/** Delete segments older than keepDays (default cfg.ledger.retentionDays / 90). */
export async function compactLedger(cfg = {}, { keepDays } = {}) {
  const keep = Number(keepDays || cfg.ledger?.retentionDays || DEFAULT_RETENTION_DAYS);
  const dir = ledgerDir(cfg);
  const cutoff = segmentName(new Date(Date.now() - keep * 86400_000).toISOString());
  const segments = await listSegments(dir);
  const removed = [];
  for (const seg of segments) {
    if (seg < cutoff) {
      try {
        await fs.unlink(path.join(dir, seg));
        removed.push(seg);
      } catch {
        /* best effort */
      }
    }
  }
  return { removed, keepDays: keep };
}
