/**
 * Persistent automation definitions + run results.
 * File: ~/.xclaw/automations.json (or cfg.paths)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function defaultPath() {
  return path.join(os.homedir(), ".xclaw", "automations.json");
}

export function automationsPath(cfg) {
  return cfg?.paths?.automationsFile || process.env.XCLAW_AUTOMATIONS_FILE || defaultPath();
}

export function loadStore(cfg) {
  const fp = automationsPath(cfg);
  try {
    if (!fs.existsSync(fp)) {
      return { version: 1, automations: [], results: [] };
    }
    const raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    return {
      version: 1,
      automations: Array.isArray(raw.automations) ? raw.automations : [],
      results: Array.isArray(raw.results) ? raw.results : [],
    };
  } catch {
    return { version: 1, automations: [], results: [] };
  }
}

export function saveStore(cfg, store) {
  const fp = automationsPath(cfg);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = fp + ".tmp";
  fs.writeFileSync(
    tmp,
    JSON.stringify(
      {
        version: 1,
        automations: store.automations || [],
        results: (store.results || []).slice(-200),
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );
  fs.renameSync(tmp, fp);
  return fp;
}

export default { loadStore, saveStore, automationsPath };
