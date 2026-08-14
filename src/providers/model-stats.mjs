/**
 * Measured model statistics (Mandate-2 slice B3) — facts, not judgment.
 *
 * Sources:
 *   ~/.xclaw/cost-ledger.jsonl   — per-run tokens/cost/model (+elapsedMs)
 *   ~/.xclaw/router-events.jsonl — failover-router events teed at emit time
 *
 * getModelStats() aggregates a window into per-model
 *   { runs, failovers, errors, successRate, avgMsPerTurn, observedUsd }.
 * Deliberately no bandits, no learned weights — one sort over declared cost
 * plus these measured facts is the whole "optimizer".
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getConfigDir } from "../config/load.mjs";

export function routerEventsPath(cfg = {}) {
  return (
    cfg.router?.eventsPath ||
    path.join(cfg.paths?.configDir || getConfigDir(), "router-events.jsonl")
  );
}

/** Best-effort tee of failover-router events; never blocks routing. */
export function appendRouterEvent(cfg, evt) {
  if (cfg?.router?.statsLog === false) return;
  if (!cfg?.paths?.configDir && !cfg?.router?.eventsPath) return; // bare cfg: no writes
  const line = JSON.stringify({ at: new Date().toISOString(), ...evt });
  fs.appendFile(routerEventsPath(cfg), line + "\n", "utf8").catch(() => {});
}

async function readJsonl(file, { maxLines = 20_000 } = {}) {
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  const lines = text.split("\n").filter(Boolean);
  return lines.slice(-maxLines).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}

/**
 * Aggregate measured stats per model ref over the window.
 * A "run" = one cost-ledger row; success = the run recorded usage without a
 * terminal router error for that model in the window.
 */
export async function getModelStats(cfg = {}, { windowDays = 7 } = {}) {
  const cutoff = Date.now() - windowDays * 86400_000;
  const ledgerFile =
    cfg.tokens?.ledgerPath ||
    path.join(cfg.paths?.configDir || getConfigDir(), "cost-ledger.jsonl");
  const rows = await readJsonl(ledgerFile);
  const events = await readJsonl(routerEventsPath(cfg));

  const out = {};
  const bump = (ref) => {
    if (!out[ref]) {
      out[ref] = { runs: 0, failovers: 0, errors: 0, turns: 0, totalMs: 0, observedUsd: 0 };
    }
    return out[ref];
  };

  for (const r of rows) {
    if (r.at && Date.parse(r.at) < cutoff) continue;
    const ref = r.modelRef || r.model;
    if (!ref) continue;
    const s = bump(ref);
    s.runs += 1;
    s.observedUsd += Number(r.costUsd ?? (r.costInUsdTicks ? r.costInUsdTicks / 1e6 : 0)) || 0;
    for (const t of r.turns || []) {
      s.turns += 1;
      if (t.elapsedMs) s.totalMs += t.elapsedMs;
    }
  }
  for (const e of events) {
    if (e.at && Date.parse(e.at) < cutoff) continue;
    const ref = e.modelRef || e.from || null;
    if (!ref) continue;
    const s = bump(ref);
    if (e.phase === "failover") s.failovers += 1;
    if (e.phase === "error") s.errors += 1;
  }

  for (const [ref, s] of Object.entries(out)) {
    const attempts = s.runs + s.failovers + s.errors;
    s.successRate = attempts ? Math.round((s.runs / attempts) * 100) / 100 : null;
    s.avgMsPerTurn = s.turns ? Math.round(s.totalMs / s.turns) : null;
    s.observedUsd = Math.round(s.observedUsd * 1e6) / 1e6;
    out[ref] = s;
  }
  return out;
}
