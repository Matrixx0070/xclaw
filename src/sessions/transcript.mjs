/**
 * Persistent conversation transcripts (JSONL per session).
 * Path: <configDir>/transcripts/<sessionId>.jsonl
 *
 * Sovereignty: local disk only; never uploaded by this module.
 *
 * transcripts/ belongs to the config dir that owns the instance, not to
 * whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single
 * transcripts/ directory, so instance B replayed instance A's history —
 * and the suite wrote into the operator's real `~/.xclaw/transcripts`.
 *
 * Production writers (`appendTranscript(cfg, ...)` at agent/loop.mjs:2021)
 * already had cfg in scope. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null` rather than guessing at the home dir.
 * Same shape as `objectivesDir`. Honour existing `XCLAW_CONFIG_DIR`.
 * Keep `cfg.paths?.transcriptsDir` as an explicit override.
 * `appendTranscript` still returns `{ ok: true }` without persisting.
 * `listTranscripts` returns `[]`. `loadTranscriptHistory` returns `[]`.
 * Do not `mkdir(null)`.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Honour `paths.transcriptsDir` then `paths.configDir` then
 * `XCLAW_CONFIG_DIR` then null. No home fallback.
 */
export function transcriptDir(cfg = {}) {
  const base =
    cfg?.paths?.transcriptsDir ||
    cfg?.paths?.configDir ||
    process.env.XCLAW_CONFIG_DIR;
  return base ? path.join(base, "transcripts") : null;
}

export function transcriptPath(cfg, sessionId) {
  const dir = transcriptDir(cfg);
  if (!dir) return null;
  const safe = String(sessionId || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(dir, `${safe}.jsonl`);
}

/**
 * Append one turn record (user/assistant/tool/system meta).
 * @returns {{ ok: boolean, path?: string, error?: string }}
 */
export function appendTranscript(cfg, sessionId, entry) {
  if (!sessionId) return { ok: false, error: "sessionId required" };
  const fp = transcriptPath(cfg, sessionId);
  if (!fp) return { ok: true };
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const line = JSON.stringify({
      at: new Date().toISOString(),
      sessionId,
      ...entry,
    });
    fs.appendFileSync(fp, line + "\n", "utf8");
    return { ok: true, path: fp };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Load messages suitable for runAgentLoop history (user/assistant/tool only).
 * @param {number} [maxMessages=40]
 */
export function loadTranscriptHistory(cfg, sessionId, maxMessages = 40) {
  if (!sessionId) return [];
  const fp = transcriptPath(cfg, sessionId);
  if (!fp) return [];
  let raw;
  try {
    raw = fs.readFileSync(fp, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.role === "user" || row.role === "assistant" || row.role === "tool") {
      out.push({
        role: row.role,
        content: row.content != null ? String(row.content) : "",
        tool_call_id: row.tool_call_id,
        name: row.name,
      });
    }
  }
  if (out.length > maxMessages) return out.slice(-maxMessages);
  return out;
}

/**
 * List transcript files (inspectability).
 */
export function listTranscripts(cfg) {
  const dir = transcriptDir(cfg);
  if (!dir) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const fp = path.join(dir, f);
        const st = fs.statSync(fp);
        return {
          sessionId: f.replace(/\.jsonl$/, ""),
          path: fp,
          bytes: st.size,
          mtime: st.mtime.toISOString(),
        };
      });
  } catch {
    return [];
  }
}

export default {
  appendTranscript,
  loadTranscriptHistory,
  listTranscripts,
  transcriptPath,
  transcriptDir,
};
