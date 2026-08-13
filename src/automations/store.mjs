/**
 * Persistent automation definitions + run results.
 * File: ~/.xclaw/automations.json (or cfg.paths)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { withFabricLock } from "../browser/fabric-lock.mjs";

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

/**
 * Run a read-modify-write against the automations store under an exclusive
 * cross-process lock, always against a freshly-loaded copy — never a
 * snapshot taken before a long-running step (e.g. an LLM call).
 *
 * Real incident this fixes: executeAutomation used to load the store once,
 * await a multi-second-to-minute LLM call, then save the ORIGINAL in-memory
 * store object — silently clobbering any write another process (a manual
 * `automations run` racing the gateway's own scheduled tick, or an
 * `automations add`/`delete` on a different automation) made in the
 * meantime, because saveStore always writes the whole file.
 *
 * The lock is held only for the fresh-load + mutate + save — milliseconds —
 * never across the caller's slow work, so a stuck/slow tick can't starve
 * unrelated store writers.
 *
 * @param {object} cfg
 * @param {(store: object) => (object|void)} mutate — mutate the store
 *   in place (or return a replacement). Runs synchronously under lock.
 * @returns {Promise<object>} the store as saved
 */
export async function withStoreLock(cfg, mutate) {
  const fp = automationsPath(cfg);
  return withFabricLock(
    () => {
      const store = loadStore(cfg);
      const next = mutate(store) || store;
      saveStore(cfg, next);
      return next;
    },
    { name: "automations-store", root: path.dirname(fp), timeoutMs: 5_000, staleMs: 15_000 }
  );
}

export default { loadStore, saveStore, automationsPath, withStoreLock };
