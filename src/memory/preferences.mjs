/**
 * R5 — Stable owner preference write-back (append-only MEMORY notes).
 * Store: <configDir>/memory/preferences.md
 *
 * preferences.md belongs to the config dir that owns the instance, not to
 * whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single
 * preferences file, so instance B loaded instance A's owner notes — and
 * the suite wrote into the operator's real `~/.xclaw/memory/preferences.md`.
 *
 * Production writers (`writePreferences(cfg)` at jobs/job.mjs:476 and
 * agent/objective.mjs:425) and the production reader (`loadPreferences(cfg)`
 * at agent/loop.mjs:430) already had cfg in scope. `loadConfig()` stamps
 * `paths.configDir` unconditionally (config/load.mjs:187), so a cfg without
 * one is never a real caller. Such a path is `null` rather than guessing
 * at the home dir. Same shape as `memoryStoreDir`. Honour existing
 * `XCLAW_CONFIG_DIR`. `writePreferences` still returns `{ ok: true, written: 0 }`
 * without persisting. `loadPreferences` returns `""`. Do not `mkdir(null)`.
 */
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Honour `paths.configDir` then `XCLAW_CONFIG_DIR` then null.
 * No home fallback.
 */
export function preferencesPath(cfg = {}) {
  const base = cfg?.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return base ? path.join(base, "memory", "preferences.md") : null;
}

function memoryPath(cfg) {
  return preferencesPath(cfg);
}

/**
 * Extract simple preference lines from text (very conservative).
 * Matches "prefer X", "always Y", "never Z" style phrases.
 */
export function extractPreferenceHints(text = "") {
  const lines = String(text).split(/\n/);
  const out = [];
  for (const line of lines) {
    const s = line.trim();
    if (s.length < 12 || s.length > 200) continue;
    if (/^(prefer|always|never|from now on|remember to)\b/i.test(s)) {
      out.push(s.replace(/^[-*•]\s*/, ""));
    }
  }
  return [...new Set(out)].slice(0, 5);
}

/**
 * Append preference notes if new.
 */
export async function writePreferences(cfg, hints = [], meta = {}) {
  if (!hints.length) return { ok: true, written: 0 };
  if (cfg?.memory?.preferenceWriteBack === false) {
    return { ok: false, reason: "disabled" };
  }
  const fp = memoryPath(cfg);
  if (!fp) return { ok: true, written: 0 };
  await fs.mkdir(path.dirname(fp), { recursive: true });
  let existing = "";
  try {
    existing = await fs.readFile(fp, "utf8");
  } catch {
    existing = "# Owner preferences (auto + manual)\n\n";
  }
  let written = 0;
  const stamp = new Date().toISOString().slice(0, 10);
  const chunks = [];
  for (const h of hints) {
    if (existing.includes(h)) continue;
    chunks.push(`- (${stamp}) ${h}`);
    written += 1;
  }
  if (!written) return { ok: true, written: 0, path: fp };
  const block =
    (meta.source ? `\n<!-- source: ${meta.source} -->\n` : "\n") +
    chunks.join("\n") +
    "\n";
  await fs.appendFile(fp, block);
  return { ok: true, written, path: fp };
}

export async function loadPreferences(cfg) {
  const fp = memoryPath(cfg);
  if (!fp) return "";
  try {
    return await fs.readFile(fp, "utf8");
  } catch {
    return "";
  }
}
