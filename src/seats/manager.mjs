/**
 * Seats — per-peer daily USD + token budgets (Phase 3).
 * Does NOT claim Grok SuperGrok/Business seats fund API usage.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function stateDir(cfg) {
  return cfg?.paths?.configDir || process.env.XCLAW_STATE_DIR || path.join(os.homedir(), ".xclaw");
}

function seatsLedgerPath(cfg) {
  return path.join(stateDir(cfg), "seats-ledger.json");
}

export function seatsEnabled(cfg) {
  return cfg?.seats?.enabled === true;
}

export function peerKey(peer) {
  if (!peer) return "default";
  if (typeof peer === "string") return peer;
  const ch = peer.channel || peer.platform || "local";
  const id = peer.id || peer.userId || peer.chatId || peer.from || "anon";
  return `${ch}:${id}`;
}

function num(fallback, ...candidates) {
  for (const v of candidates) {
    if (v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/**
 * Resolve seat config for a peer.
 */
export function resolveSeat(cfg, peer) {
  const s = cfg?.seats || {};
  const key = peerKey(peer);
  const byPeer = s.byPeer || {};
  const overrides = byPeer[key] || byPeer[peer?.id] || {};
  // Every one of these is multiplied into a cap: `dailyUsd * hardPct`. A value
  // that is not a number makes the cap NaN, and `projected > NaN` is false for
  // every spend — so a malformed seat budget does not fail closed, it removes
  // the cap. And because the hard cap is tested BEFORE the soft one, a soft
  // percentage at or above the hard one makes the warning unreachable: an
  // operator who tightens `hardPct` to 0.5 leaves the default `softPct` of 0.8
  // above it and the seat jumps from allowed to denied with no warning first.
  // Zero stays zero on both — the strictest value is a value, not an absent one.
  const hard = num(1.0, overrides.hardPct, s.hardPct);
  const softRaw = Math.max(0, num(0.8, overrides.softPct, s.softPct));
  const soft = softRaw < hard ? softRaw : Math.min(0.8, hard * 0.8);
  return {
    id: overrides.id || key,
    peerKey: key,
    label: overrides.label || key,
    enabled: overrides.enabled !== false,
    dailyUsd: num(2, overrides.dailyUsd, s.defaultDailyUsd),
    dailyTokens: num(500_000, overrides.dailyTokens, s.defaultDailyTokens),
    softPct: soft,
    hardPct: hard,
    paused: Boolean(overrides.paused),
  };
}

async function loadLedger(cfg) {
  try {
    return JSON.parse(await fs.readFile(seatsLedgerPath(cfg), "utf8"));
  } catch {
    return { day: dayKey(), seats: {} };
  }
}

async function saveLedger(cfg, ledger) {
  const fp = seatsLedgerPath(cfg);
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(ledger, null, 2), { mode: 0o600 });
}

function seatDay(ledger, seatId) {
  if (!ledger.seats[seatId] || ledger.seats[seatId].day !== ledger.day) {
    ledger.seats[seatId] = {
      day: ledger.day,
      spentUsd: 0,
      tokens: 0,
      jobs: 0,
      denies: 0,
      events: [],
    };
  }
  return ledger.seats[seatId];
}

/**
 * Preflight: soft warn or hard deny.
 */
export async function checkSeatBudget(cfg, peer, { estimateUsd = 0, estimateTokens = 0 } = {}) {
  if (!seatsEnabled(cfg)) {
    return { ok: true, enabled: false, skipped: true };
  }
  const seat = resolveSeat(cfg, peer);
  if (!seat.enabled || seat.paused) {
    return {
      ok: false,
      hard: true,
      seat,
      message: seat.paused ? `Seat ${seat.label} is paused` : `Seat ${seat.label} disabled`,
    };
  }

  let ledger = await loadLedger(cfg);
  if (ledger.day !== dayKey()) {
    ledger = { day: dayKey(), seats: {} };
    await saveLedger(cfg, ledger);
  }
  const row = seatDay(ledger, seat.id);
  const projectedUsd = (row.spentUsd || 0) + (estimateUsd || 0);
  const projectedTok = (row.tokens || 0) + (estimateTokens || 0);

  const hardUsd = seat.dailyUsd * seat.hardPct;
  const softUsd = seat.dailyUsd * seat.softPct;
  const hardTok = seat.dailyTokens * seat.hardPct;
  const softTok = seat.dailyTokens * seat.softPct;

  if (projectedUsd > hardUsd || projectedTok > hardTok) {
    row.denies = (row.denies || 0) + 1;
    row.events = (row.events || []).slice(-20);
    row.events.push({
      at: new Date().toISOString(),
      type: "deny",
      spentUsd: row.spentUsd,
      tokens: row.tokens,
    });
    await saveLedger(cfg, ledger);
    return {
      ok: false,
      hard: true,
      soft: true,
      seat,
      spentUsd: row.spentUsd,
      tokens: row.tokens,
      limits: { hardUsd, softUsd, hardTok, softTok },
      message: `Seat ${seat.label} hard cap (usd $${row.spentUsd.toFixed(4)}/$${hardUsd.toFixed(2)} tokens ${row.tokens}/${Math.floor(hardTok)})`,
    };
  }

  if (projectedUsd > softUsd || projectedTok > softTok) {
    return {
      ok: true,
      soft: true,
      hard: false,
      seat,
      spentUsd: row.spentUsd,
      tokens: row.tokens,
      limits: { hardUsd, softUsd, hardTok, softTok },
      message: `Seat ${seat.label} soft cap warning`,
    };
  }

  return {
    ok: true,
    soft: false,
    hard: false,
    seat,
    spentUsd: row.spentUsd,
    tokens: row.tokens,
    limits: { hardUsd, softUsd, hardTok, softTok },
  };
}

export async function recordSeatUsage(
  cfg,
  peer,
  { usd = 0, tokens = 0, jobId = null } = {}
) {
  if (!seatsEnabled(cfg)) return { skipped: true };
  const seat = resolveSeat(cfg, peer);
  let ledger = await loadLedger(cfg);
  if (ledger.day !== dayKey()) {
    ledger = { day: dayKey(), seats: {} };
  }
  const row = seatDay(ledger, seat.id);
  row.spentUsd = Math.round(((row.spentUsd || 0) + (usd || 0)) * 1e6) / 1e6;
  row.tokens = (row.tokens || 0) + (tokens || 0);
  row.jobs = (row.jobs || 0) + 1;
  row.events = (row.events || []).slice(-40);
  row.events.push({
    at: new Date().toISOString(),
    type: "usage",
    usd,
    tokens,
    jobId,
  });
  await saveLedger(cfg, ledger);
  return { seat: seat.id, spentUsd: row.spentUsd, tokens: row.tokens, jobs: row.jobs };
}

export async function listSeatsStatus(cfg) {
  const ledger = await loadLedger(cfg);
  if (ledger.day !== dayKey()) {
    return { day: dayKey(), enabled: seatsEnabled(cfg), seats: [] };
  }
  const s = cfg?.seats || {};
  const keys = new Set([
    ...Object.keys(s.byPeer || {}),
    ...Object.keys(ledger.seats || {}),
  ]);
  if (keys.size === 0) keys.add("default");

  const seats = [];
  for (const k of keys) {
    const peer = k.includes(":") ? { channel: k.split(":")[0], id: k.slice(k.indexOf(":") + 1) } : { id: k };
    const seat = resolveSeat(cfg, peer);
    const row = ledger.seats[seat.id] || { spentUsd: 0, tokens: 0, jobs: 0, denies: 0 };
    seats.push({
      ...seat,
      spentUsd: row.spentUsd || 0,
      tokens: row.tokens || 0,
      jobs: row.jobs || 0,
      denies: row.denies || 0,
      remainingUsd: Math.max(0, seat.dailyUsd - (row.spentUsd || 0)),
      remainingTokens: Math.max(0, seat.dailyTokens - (row.tokens || 0)),
    });
  }
  return { day: ledger.day, enabled: seatsEnabled(cfg), seats };
}

export async function resetSeatDay(cfg, seatId = null) {
  let ledger = await loadLedger(cfg);
  if (!seatId) {
    ledger = { day: dayKey(), seats: {} };
  } else if (ledger.seats[seatId]) {
    ledger.seats[seatId] = {
      day: dayKey(),
      spentUsd: 0,
      tokens: 0,
      jobs: 0,
      denies: 0,
      events: [],
    };
  }
  ledger.day = dayKey();
  await saveLedger(cfg, ledger);
  return listSeatsStatus(cfg);
}

export async function setSeatPaused(cfg, peerOrId, paused) {
  // runtime pause stored in ledger meta
  const seat = resolveSeat(cfg, typeof peerOrId === "string" ? { id: peerOrId } : peerOrId);
  let ledger = await loadLedger(cfg);
  if (ledger.day !== dayKey()) ledger = { day: dayKey(), seats: {} };
  const row = seatDay(ledger, seat.id);
  row.paused = Boolean(paused);
  await saveLedger(cfg, ledger);
  return { id: seat.id, paused: row.paused };
}
