/**
 * Operational-ledger HTTP routes (Mandate-2 slice A1).
 *
 * Paths:
 *   GET /ledger        — query with filters (kind, since, status, ids, artifact, limit)
 *   GET /ledger/stats  — segment/bytes summary + shared-writer counters
 *   GET /ledger/who-touched?path=… — attribution join over tool artifacts + merges
 */
import {
  queryLedger,
  ledgerStats,
  whoTouched,
  getSharedLedger,
} from "../../ops/ledger.mjs";

export async function tryHandleLedgerRoute({ p, method, url, cfg, res, json }) {
  if (!p.startsWith("/ledger")) return false;
  if (method !== "GET") {
    json(res, 405, { error: "method not allowed" });
    return true;
  }
  if (p === "/ledger/stats") {
    const stats = await ledgerStats(cfg);
    json(res, 200, { ...stats, writer: getSharedLedger(cfg).stats() });
    return true;
  }
  if (p === "/ledger/who-touched") {
    const target = url.searchParams.get("path");
    if (!target) {
      json(res, 400, { error: "path query parameter required" });
      return true;
    }
    const hits = await whoTouched(cfg, target, {
      since: url.searchParams.get("since") || "30d",
      limit: Number(url.searchParams.get("limit") || 50),
    });
    json(res, 200, { path: target, hits });
    return true;
  }
  if (p === "/ledger") {
    const filters = {};
    for (const k of [
      "kind",
      "since",
      "until",
      "status",
      "artifact",
      "limit",
      "sessionId",
      "jobId",
      "missionId",
      "swarmId",
      "nodeId",
      "runId",
    ]) {
      const v = url.searchParams.get(k);
      if (v) filters[k] = v;
    }
    const out = await queryLedger(cfg, filters);
    json(res, 200, out);
    return true;
  }
  return false;
}
