/**
 * Persistent conversation transcripts (JSONL per session).
 * Path: ~/.xclaw/transcripts/<sessionId>.jsonl
 *
 * Sovereignty: local disk only; never uploaded by this module.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function transcriptDir(cfg) {
  const base =
    cfg?.paths?.transcriptsDir ||
    cfg?.paths?.configDir ||
    path.join(os.homedir(), ".xclaw");
  return path.join(base, "transcripts");
}

export function transcriptPath(cfg, sessionId) {
  const safe = String(sessionId || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(transcriptDir(cfg), `${safe}.jsonl`);
}

/**
 * Append one turn record (user/assistant/tool/system meta).
 * @returns {{ ok: boolean, path?: string, error?: string }}
 */
export function appendTranscript(cfg, sessionId, entry) {
  if (!sessionId) return { ok: false, error: "sessionId required" };
  try {
    const fp = transcriptPath(cfg, sessionId);
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
