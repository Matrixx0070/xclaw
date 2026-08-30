/**
 * Trust Sprint (2026-08-23) — deterministic verify-check derivation and
 * sanitization for long-run objectives.
 *
 * Why this exists: the E-A deterministic gate only ran when an objective
 * CARRIED typed verify checks — and the live chat/API launch path armed
 * none, so runDeterministicChecks returned {ok:true, ran:false} and
 * completion collapsed to the model asserting its own criteria. Live
 * benchmark F (2026-08-23) proved the failure: given a migration script
 * hard-coded to fail records 4–5, the agent EDITED the script to delete the
 * failures and declared 5/5 migrated — status done, nothing caught it.
 *
 * Three trust levels of checks (per-check `source` field):
 *   "api"     — operator-provided via POST /objectives {verify}. Trusted.
 *   "runtime" — derived from the project's own structure (test/lint
 *               scripts), baseline-filtered so pre-existing failures never
 *               gate a mission; OR from the goal text (file_exists /
 *               file_contains via deriveGoalVerifyChecks) WITHOUT a
 *               baseline pass — the named artifact does not exist yet.
 *               Trusted.
 *   "model"   — proposed by the model in its state block. These can REJECT
 *               a completion but never CLOSE one on their own: a model that
 *               gamed the work could just as easily propose a check that
 *               passes on the gamed state. Restricted to file assertions
 *               and READ-ONLY commands (risk.mjs single-source scanner) so
 *               the verify gate is not an approval-gate bypass.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isReadOnlyExecCommand } from "../security/risk.mjs";
import { runVerifyChecks } from "../jobs/verify.mjs";

export const VERIFY_CHECK_TYPES = new Set([
  "file_exists",
  "file_not_exists",
  "file_contains",
  "file_equals",
  "command",
  "text_contains",
]);

const MODEL_CHECK_CAP = 12;

/**
 * Derive verification commands from the project the objective works in
 * (same detection missions/engine.mjs uses). Returns [] when nothing is
 * detectable — the gate then fails CLOSED (owner approval), never open.
 */
export async function deriveVerifyChecks(workingDir) {
  const dir = workingDir || process.cwd();
  const checks = [];
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
    const scripts = pkg.scripts || {};
    if (scripts.lint) {
      checks.push({ type: "command", cmd: "npm run lint --silent", timeoutMs: 300_000, source: "runtime" });
    }
    if (scripts.test) {
      checks.push({ type: "command", cmd: "npm test --silent", timeoutMs: 900_000, source: "runtime" });
    }
    if (checks.length) return checks;
  } catch {
    /* not a node project */
  }
  const byMarker = [
    ["pyproject.toml", "python -m pytest -q"],
    ["go.mod", "go test ./..."],
    ["Cargo.toml", "cargo test --quiet"],
  ];
  for (const [marker, cmd] of byMarker) {
    try {
      await fs.access(path.join(dir, marker));
      return [{ type: "command", cmd, timeoutMs: 900_000, source: "runtime" }];
    } catch {
      /* next */
    }
  }
  return [];
}

/**
 * Run derived checks ONCE at mission start and arm only the ones that pass.
 * A check that already fails before any work happened is a pre-existing
 * project condition, not mission signal — gating on it would trap every
 * mission in a repo with a red suite.
 */
export async function baselineArmChecks(workingDir, checks = []) {
  const armed = [];
  const dropped = [];
  for (const check of checks) {
    try {
      const res = await runVerifyChecks(workingDir || process.cwd(), [check]);
      if (res.ok) armed.push(check);
      else dropped.push({ check, detail: res.results?.[0]?.detail || "baseline fail" });
    } catch (e) {
      dropped.push({ check, detail: String(e?.message || e) });
    }
  }
  return { armed, dropped };
}

/**
 * Sanitize model-proposed verify checks from a state block.
 *  - unknown types dropped
 *  - command checks must be READ-ONLY (quote-aware scanner) — a write
 *    command in a verify check would execute outside the approval gate
 *  - deduped against existing checks, capped at MODEL_CHECK_CAP model checks
 * Every surviving check is stamped source:"model".
 */
export function sanitizeModelVerifyChecks(raw, existing = []) {
  if (!Array.isArray(raw)) return [];
  const keyOf = (c) =>
    JSON.stringify([c.type, c.path || null, c.cmd || null, c.text || null, c.regex || null, c.content ?? c.value ?? null]);
  const seen = new Set(existing.map(keyOf));
  let modelCount = existing.filter((c) => c.source === "model").length;
  const out = [];
  for (const r of raw.slice(0, 40)) {
    if (!r || typeof r !== "object") continue;
    const type = String(r.type || "");
    if (!VERIFY_CHECK_TYPES.has(type)) continue;
    if (modelCount >= MODEL_CHECK_CAP) break;
    const check = { type, source: "model" };
    if (r.path != null) check.path = String(r.path).slice(0, 500);
    if (r.text != null) check.text = String(r.text).slice(0, 500);
    if (r.regex != null) check.regex = String(r.regex).slice(0, 300);
    if (r.content != null) check.content = String(r.content).slice(0, 2000);
    else if (r.value != null) check.value = String(r.value).slice(0, 2000);
    if (r.haystack != null) check.haystack = String(r.haystack).slice(0, 4000);
    if (type === "command") {
      const cmd = String(r.cmd || "").slice(0, 500);
      if (!cmd || !isReadOnlyExecCommand(cmd)) continue; // never an approval bypass
      check.cmd = cmd;
      check.timeoutMs = Math.min(Math.max(Number(r.timeoutMs) || 15_000, 1_000), 120_000);
    }
    if ((type === "file_exists" || type === "file_not_exists" || type === "file_contains" || type === "file_equals") && !check.path) continue;
    if (type === "file_contains" && !check.text && !check.regex) continue;
    if (type === "text_contains" && !check.text) continue;
    const key = keyOf(check);
    if (seen.has(key)) continue;
    seen.add(key);
    modelCount += 1;
    out.push(check);
  }
  return out;
}

export default { deriveVerifyChecks, baselineArmChecks, sanitizeModelVerifyChecks, VERIFY_CHECK_TYPES };
