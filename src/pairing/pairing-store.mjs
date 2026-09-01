/**
 * Adapted from OpenClaw (MIT) — pairing-store patterns (file-backed, no SQLite).
 * https://github.com/openclaw/openclaw
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const CHANNEL_PAIRING_PENDING_TTL_MS = 60 * 60 * 1000;
export const CHANNEL_PAIRING_PENDING_MAX = 3;
const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Pairing.json belongs to the config dir that owns the instance, not to
 * whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single
 * pairing.json, so instance B's approve/revoke mixed with instance A's —
 * and the suite wrote into the operator's real `~/.xclaw/pairing.json`.
 * `test/pairing-routes.test.mjs` HOME-overrode because of this — that
 * override is evidence of the leak, not a fix.
 *
 * Production `createPairingStore({})` at gateway boot, security pairing
 * routes (recreate per request — the file is the only shared state),
 * doctor, and CLI already had cfg in scope and did not thread it.
 * Telegram/Discord already pass `storePath`; an undefined storePath still
 * fell through to home.
 *
 * `loadConfig()` stamps `paths.configDir` unconditionally
 * (config/load.mjs:187), so a cfg without one is never a real caller.
 * Such a store stays in memory and reports `storePath: null` rather than
 * guessing at the home dir. Same shape as `defaultStatePath` in
 * alerts.mjs. Explicit `paths.pairingFile` / `XCLAW_PAIRING_FILE` /
 * `opts.storePath` still win.
 */
export function resolvePairingStorePath(cfg) {
  const explicit = cfg?.paths?.pairingFile;
  if (typeof explicit === "string" && explicit) return explicit;
  if (process.env.XCLAW_PAIRING_FILE) return process.env.XCLAW_PAIRING_FILE;
  const dir = cfg?.paths?.configDir;
  return dir ? path.join(dir, "pairing.json") : null;
}

function generateCode() {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_CODE_ALPHABET[
      crypto.randomInt(0, PAIRING_CODE_ALPHABET.length)
    ];
  }
  return code;
}

function emptyState() {
  return { channels: {} };
}

function loadState(storePath) {
  if (!storePath) return emptyState();
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch {
    return emptyState();
  }
}

function saveState(storePath, state) {
  if (!storePath) return;
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(state, null, 2));
}

function channelState(state, channel) {
  if (!state.channels[channel]) {
    state.channels[channel] = { pending: [], approved: [] };
  }
  return state.channels[channel];
}

function isExpired(entry, nowMs) {
  const createdAt = Date.parse(entry.createdAt);
  return !Number.isFinite(createdAt) || nowMs - createdAt > CHANNEL_PAIRING_PENDING_TTL_MS;
}

function prune(pending, nowMs) {
  return pending.filter((e) => !isExpired(e, nowMs));
}

/**
 * Create pairing store.
 * @param {{ storePath?: string, cfg?: object }} opts
 */
export function createPairingStore(opts = {}) {
  const storePath =
    (typeof opts.storePath === "string" && opts.storePath) ||
    resolvePairingStorePath(opts.cfg || opts);
  // No file to own it: keep the snapshot on this instance. A second
  // createPairingStore({}) does not share state — that is the point of
  // refusing the home fallback. Production callers always have configDir.
  let memory = emptyState();

  function read() {
    if (!storePath) return memory;
    return loadState(storePath);
  }

  function write(state) {
    if (!storePath) {
      memory = state;
      return;
    }
    saveState(storePath, state);
  }

  function listApproved(channel) {
    const st = channelState(read(), channel);
    return [...(st.approved || [])];
  }

  function isApproved(channel, senderId) {
    const id = String(senderId);
    return listApproved(channel).some((a) => String(a.id) === id);
  }

  function approve(channel, codeOrId) {
    const state = read();
    const st = channelState(state, channel);
    const now = Date.now();
    st.pending = prune(st.pending, now);
    const idx = st.pending.findIndex(
      (p) => p.code === codeOrId || p.id === codeOrId
    );
    if (idx < 0) return { ok: false, error: "not_found" };
    const [req] = st.pending.splice(idx, 1);
    if (!st.approved.some((a) => a.id === req.id)) {
      st.approved.push({
        id: req.id,
        meta: req.meta || {},
        approvedAt: new Date().toISOString(),
      });
    }
    write(state);
    return { ok: true, senderId: req.id, code: req.code };
  }

  function revoke(channel, senderId) {
    const state = read();
    const st = channelState(state, channel);
    const before = st.approved.length;
    st.approved = st.approved.filter((a) => String(a.id) !== String(senderId));
    write(state);
    return { ok: true, removed: before - st.approved.length };
  }

  /**
   * Upsert pending pairing request for sender.
   */
  function upsertPairingRequest({ channel, id, meta }) {
    const state = read();
    const st = channelState(state, channel);
    const now = Date.now();
    st.pending = prune(st.pending, now);

    const existing = st.pending.find((p) => p.id === String(id));
    if (existing) {
      existing.lastSeenAt = new Date().toISOString();
      write(state);
      return { created: false, code: existing.code, id: existing.id };
    }

    while (st.pending.length >= CHANNEL_PAIRING_PENDING_MAX) {
      st.pending.shift();
    }

    let code = generateCode();
    for (let i = 0; i < 20; i++) {
      if (!st.pending.some((p) => p.code === code)) break;
      code = generateCode();
    }

    const req = {
      id: String(id),
      code,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      meta: meta || {},
    };
    st.pending.push(req);
    write(state);
    return { created: true, code, id: req.id };
  }

  function listPending(channel) {
    const state = read();
    const st = channelState(state, channel);
    st.pending = prune(st.pending, Date.now());
    write(state);
    return [...st.pending];
  }

  return {
    storePath,
    listApproved,
    isApproved,
    approve,
    revoke,
    upsertPairingRequest,
    listPending,
  };
}

export function buildPairingReply({ channel, idLine, code }) {
  return [
    "XClaw: access not configured.",
    "",
    idLine,
    "Pairing code:",
    "```",
    code,
    "```",
    "",
    "Ask the bot owner to approve with:",
    "```",
    `xclaw pairing approve ${channel} ${code}`,
    "```",
  ].join("\n");
}
