/**
 * Derive the file surface a self mission must never be able to edit.
 *
 * `SELF_DENY_PATHS` is a hand-typed list, and a hand-typed list cannot be its
 * own guard: the entry nobody remembered to add is exactly the entry that fails
 * open. So the list is graded against two sets derived from the repository
 * itself, each of which grows on its own when the code grows.
 *
 * 1. The **enforcement chain** — every module carrying an identifier the edit
 *    guard needs in order to work at all. The guard denied the policy
 *    (`src/self/`, `src/security/`) but not the machinery that ranks its
 *    verdict, acts on it, or installs it, so a self mission could edit
 *    `src/hooks/manager.mjs` and the *next* self mission would run with no
 *    boundary. Derived by scanning for the markers, not by naming files.
 *
 * 2. The **verify floor** — the runner files a mission's verify commands
 *    actually execute, resolved through `package.json`'s script map. The floor
 *    is what stands between an autonomous edit and `main`: on a host without
 *    `cfg.self.requireMergeApproval`, `missions/engine.mjs` force-sets
 *    `autoMerge` true, so a passing floor merges itself.
 *
 * Known limits, stated rather than papered over: `test/` is not derivable as
 * protected (a self mission legitimately adds tests, and forbidding the whole
 * directory would block that), and this walks the floor's *entry* runners, not
 * every module they later import. Neither is a hole this module can close;
 * both are reasons the diff of a self mission still deserves human eyes.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isDeniedPath, SELF_DENY_PATHS, selfVerifyCommands } from "./profile.mjs";

/**
 * Identifiers that only appear in code participating in the edit-surface
 * decision: defining the list, matching against it, building the hook,
 * installing it, ranking its verdict, or acting on a deny.
 */
export const GUARD_MARKERS = [
  "SELF_DENY_PATHS",
  "isDeniedPath",
  "editSurfaceGuard",
  "registerEditSurfaceHook",
  "applySelfOverlay",
  "DECISION_RANK",
  'decision === "deny"',
];

/**
 * The generated computer bundle vendors source into a 17MB artifact (ADR 0006
 * keeps it hand-patchable). It carries none of these markers today; if one ever
 * appears there it will be a *copy* of a module scanned separately, so the hit
 * would name a file no operator hand-edits. Reading it to learn that costs
 * ~50ms on every call.
 */
const SCAN_SKIP = new Set(["src/computer/xclaw-server.mjs"]);

/**
 * Both executable roots, not just `src`: narrowing the scan to where the guard
 * happens to live today would bake in the same assumption this module exists to
 * remove.
 */
const SCAN_ROOTS = ["src", "bin"];

async function walkFiles(repoDir, rel, out) {
  let entries;
  try {
    entries = await fs.readdir(path.join(repoDir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) await walkFiles(repoDir, child, out);
    else if (/\.(mjs|js)$/.test(e.name) && !SCAN_SKIP.has(child)) out.push(child);
  }
  return out;
}

/**
 * Repo-relative paths of every module that carries a guard marker.
 *
 * @param {string} repoDir
 * @returns {Promise<string[]>} sorted
 */
export async function enforcementChainFiles(repoDir) {
  const files = [];
  for (const root of SCAN_ROOTS) await walkFiles(repoDir, root, files);
  const hits = [];
  for (const rel of files) {
    let src;
    try {
      src = await fs.readFile(path.join(repoDir, rel), "utf8");
    } catch {
      continue;
    }
    if (GUARD_MARKERS.some((m) => src.includes(m))) hits.push(rel);
  }
  return hits.sort();
}

/** Repo-relative runner file a shell command executes, or null. */
function commandFile(cmd) {
  const tokens = String(cmd || "").trim().split(/\s+/);
  const head = tokens[0];
  if (head !== "node" && head !== "npx" && !head?.endsWith("/node")) return null;
  const file = tokens.slice(1).find((t) => !t.startsWith("-") && /\.(mjs|js|cjs)$/.test(t));
  return file ? file.replace(/^\.\//, "") : null;
}

/** npm script name a shell command invokes, or null. */
function commandScript(cmd) {
  const tokens = String(cmd || "").trim().split(/\s+/);
  if (tokens[0] !== "npm") return null;
  if (tokens[1] === "test") return "test";
  if (tokens[1] === "run" && tokens[2]) return tokens[2];
  return null;
}

/**
 * Files the verify floor executes: `package.json` (the script map every
 * `npm run` resolves through) plus each runner reachable from the mission's
 * verify commands, following script-to-script indirection.
 *
 * @param {string} repoDir
 * @param {object} cfg
 * @returns {Promise<string[]>} sorted
 */
export async function verifyFloorFiles(repoDir, cfg = {}) {
  const out = new Set(["package.json"]);
  let scripts = {};
  try {
    scripts = JSON.parse(await fs.readFile(path.join(repoDir, "package.json"), "utf8")).scripts || {};
  } catch {
    return [...out];
  }
  const queue = selfVerifyCommands(cfg).slice();
  const seen = new Set();
  while (queue.length) {
    const cmd = queue.shift();
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    const file = commandFile(cmd);
    if (file) out.add(file);
    const script = commandScript(cmd);
    if (script && scripts[script]) queue.push(scripts[script]);
  }
  return [...out].sort();
}

/**
 * Which derived files a deny list fails to cover. Empty means the hand-typed
 * list still spans everything the repository says it must.
 *
 * @param {{repoDir: string, cfg?: object, denyPaths?: string[]}} opts
 * @returns {Promise<{enforcement: string[], verify: string[]}>}
 */
export async function uncoveredGuardSurface({ repoDir, cfg = {}, denyPaths = SELF_DENY_PATHS } = {}) {
  const uncovered = (list) => list.filter((rel) => !isDeniedPath(rel, denyPaths));
  return {
    enforcement: uncovered(await enforcementChainFiles(repoDir)),
    verify: uncovered(await verifyFloorFiles(repoDir, cfg)),
  };
}
