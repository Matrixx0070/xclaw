/**
 * Persistent automation definitions + run results.
 *
 * Honour `paths.automationsFile` then `XCLAW_AUTOMATIONS_FILE` then
 * `paths.configDir` + `automations.json`. No configDir → null. No home
 * fallback. Production `hydrateAutomations(cfg)` already threads cfg so
 * live still persists under configDir.
 */
import fs from "node:fs";
import path from "node:path";
import { withFabricLock } from "../browser/fabric-lock.mjs";

export function automationsPath(cfg) {
  const explicit = cfg?.paths?.automationsFile;
  if (typeof explicit === "string" && explicit) return explicit;
  if (process.env.XCLAW_AUTOMATIONS_FILE) return process.env.XCLAW_AUTOMATIONS_FILE;
  const dir = cfg?.paths?.configDir;
  return dir ? path.join(dir, "automations.json") : null;
}

export function loadStore(cfg) {
  const fp = automationsPath(cfg);
  if (!fp) return { version: 1, automations: [], results: [] };
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
  if (!fp) return null;
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
 * A null path (no configDir / explicit file / env) mutates in-memory
 * without a lockfile. Do not `path.dirname(null)` which would lock cwd.
 *
 * @param {object} cfg
 * @param {(store: object) => (object|void)} mutate — mutate the store
 *   in place (or return a replacement). Runs synchronously under lock.
 * @returns {Promise<object>} the store as saved
 */
export async function withStoreLock(cfg, mutate) {
  const fp = automationsPath(cfg);
  if (!fp) {
    const store = loadStore(cfg);
    const next = mutate(store) || store;
    saveStore(cfg, next);
    return next;
  }
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
