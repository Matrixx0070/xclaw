/**
 * R5 — Stable owner preference write-back (append-only MEMORY notes).
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function memoryPath(cfg) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "memory", "preferences.md");
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
  try {
    return await fs.readFile(fp, "utf8");
  } catch {
    return "";
  }
}
