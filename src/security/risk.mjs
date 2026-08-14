/**
 * Zero-trust risk assessment (Mandate-2 slice A2).
 *
 * Deterministic facts → factors → tier. Deliberately NOT a rules DSL and NOT
 * a model-in-the-gate: the extractor reads cheap facts (tool family, resolved
 * paths, command text patterns, egress) and maps them through one small tier
 * table. Models may only RAISE risk via the existing pre_tool_use hook
 * decision merge ("ask") — they never authorize. If the fact table ever grows
 * past a screen, lean harder on hook escalation, not on more rules.
 *
 * Factors:
 *   scope:         workspace | home | system
 *   impact:        read | write | exec | egress
 *   reversibility: reversible | recoverable | irreversible
 *   blastRadius:   file | repo | host | remote
 *   recovery:      worktree | git | none
 * Tier: safe | low | risky | critical  (max-of-factors, table overridable via
 * cfg.security.risk.tiers)
 */
import path from "node:path";
import os from "node:os";
import fsSync from "node:fs";

export const RISK_TIERS = ["safe", "low", "risky", "critical"];

export function tierRank(tier) {
  const i = RISK_TIERS.indexOf(String(tier || ""));
  return i < 0 ? RISK_TIERS.length - 1 : i; // unknown tier = most severe
}

const READ_RE = /read|list|glob|grep|search|recall|repo_intel|status|show/i;
const WRITE_RE = /write|edit|append|create|delete|remove|move|copy|mkdir/i;
const EXEC_RE = /bash|shell|exec|terminal|run|spawn/i;
const EGRESS_RE = /web_|fetch|http|browser|navigate|download|upload|api/i;

// Irreversible command facts — each entry is (pattern, reason).
const IRREVERSIBLE_CMD = [
  [/\bgit\s+push\s+.*--force/, "git force-push rewrites remote history"],
  [/\bgit\s+reset\s+--hard/, "hard reset discards work"],
  [/\b(npm|yarn|pnpm)\s+publish\b/, "package publish is public"],
  [/\bgh\s+release\s+create\b/, "public release"],
  [/\b(curl|wget)\b[^|]*\|\s*(ba|z|da)?sh\b/, "pipe-to-shell executes remote code"],
  [/\bdd\s+[^|]*of=\/dev\//, "raw device write"],
  [/\bmkfs\b/, "filesystem format"],
  [/\b(shutdown|reboot|halt|poweroff)\b/, "host power state"],
  [/\bpm2\s+(delete|kill)\b/, "removes supervised services"],
  [/\bdocker\s+(system\s+prune|rmi)\b/, "destroys images/containers"],
  [/\bDROP\s+(TABLE|DATABASE)\b/i, "destructive SQL"],
  // exec-level writes into system paths (redirection/copy/install)
  [/(?:>>?|\btee\b|\bcp\b.*\s|\bmv\b.*\s|\binstall\b.*\s)\/(?:etc|usr\/(?:bin|sbin|lib)|bin|sbin|boot|lib\/systemd)\//, "writes to system path"],
];

const CREDENTIAL_PATH_RE = /\.ssh\/|credentials|\.env(\.|$)|secrets?\.|\.pem$|id_rsa|oauth|token/i;

function extractPaths(args = {}) {
  const out = [];
  for (const k of ["path", "file", "filepath", "filename", "target", "dest", "dir", "cwd", "workingDir"]) {
    if (typeof args[k] === "string" && args[k]) out.push(args[k]);
  }
  return out;
}

function commandText(args = {}) {
  return String(args.command ?? args.cmd ?? args.script ?? args.input ?? "");
}

function classifyScope(p, workingDir) {
  const abs = path.resolve(workingDir || process.cwd(), p);
  const ws = path.resolve(workingDir || process.cwd());
  if (abs === ws || abs.startsWith(ws + path.sep)) return "workspace";
  const home = os.homedir();
  if (abs === home || abs.startsWith(home + path.sep)) return "home";
  return "system";
}

function worstScope(scopes) {
  if (scopes.includes("system")) return "system";
  if (scopes.includes("home")) return "home";
  return "workspace";
}

function isGitWorkspace(workingDir) {
  try {
    let dir = path.resolve(workingDir || process.cwd());
    for (let i = 0; i < 6; i++) {
      if (fsSync.existsSync(path.join(dir, ".git"))) return true;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* fall through */
  }
  return false;
}

/**
 * Assess one action. context: { worktree?: boolean } — mission worktrees make
 * workspace writes recoverable by construction.
 */
export function assessRisk({ tool, args = {}, workingDir, cfg = {}, context = {} } = {}) {
  const name = String(tool || "");
  const reasons = [];

  // impact from tool family
  let impact = "read";
  if (EXEC_RE.test(name)) impact = "exec";
  else if (WRITE_RE.test(name)) impact = "write";
  else if (EGRESS_RE.test(name)) impact = "egress";
  else if (READ_RE.test(name)) impact = "read";
  else impact = "exec"; // unknown tools: assume the worst reasonable

  const cmd = impact === "exec" ? commandText(args) : "";
  const paths = extractPaths(args);

  // scope from resolved path operands (+ command path mentions for exec)
  const scopes = paths.map((p) => classifyScope(p, workingDir));
  if (cmd) {
    for (const m of cmd.matchAll(/(?:^|\s)(\/[\w./-]+|~\/[\w./-]+)/g)) {
      scopes.push(classifyScope(m[1].replace(/^~/, os.homedir()), workingDir));
    }
  }
  const scope = scopes.length ? worstScope(scopes) : "workspace";

  // reversibility facts
  let reversibility = impact === "read" ? "reversible" : "recoverable";
  if (cmd) {
    for (const [re, why] of IRREVERSIBLE_CMD) {
      if (re.test(cmd)) {
        reversibility = "irreversible";
        reasons.push(why);
        break;
      }
    }
    // Recursive/forced delete: scope-aware — nuking workspace build dirs is
    // routine engineering; any out-of-workspace target is unrecoverable.
    if (reversibility !== "irreversible" && /\brm\s+(-\w*[rf]\w*\s+)+/.test(cmd)) {
      if (scope !== "workspace") {
        reversibility = "irreversible";
        reasons.push("recursive delete outside workspace");
      } else {
        reasons.push("recursive delete (workspace-scoped)");
      }
    }
  }
  if (
    (impact === "write" || impact === "exec") &&
    [...paths, cmd].some((s) => CREDENTIAL_PATH_RE.test(String(s)))
  ) {
    reversibility = "irreversible";
    reasons.push("touches credential/secret material");
  }
  // Write TOOLS targeting paths outside the workspace have no recovery
  // machinery. Exec merely MENTIONING an outside path is not escalated —
  // destructive exec is caught by the command facts above, or a hook raises.
  if (reversibility !== "irreversible" && impact === "write" && scope !== "workspace") {
    reversibility = "irreversible";
    reasons.push(`writes outside workspace (${scope})`);
  }

  // blast radius
  let blastRadius = "file";
  if (impact === "egress" || /\bgit\s+push|publish|release/.test(cmd)) blastRadius = "remote";
  else if (scope === "system" || /\bpm2\b|\bsystemctl\b|\bservice\b/.test(cmd)) blastRadius = "host";
  else if (/\bgit\b/.test(cmd) || paths.length > 3) blastRadius = "repo";

  // recovery
  const recovery = context.worktree
    ? "worktree"
    : isGitWorkspace(workingDir)
      ? "git"
      : "none";
  if (recovery === "worktree" && reversibility === "recoverable" && scope === "workspace") {
    // isolated worktree: workspace mutations are discardable by design
    reasons.push("isolated worktree — discardable");
  }

  const factors = { scope, impact, reversibility, blastRadius, recovery };
  const tier = mapTier(factors, cfg);
  return { tier, factors, reasons };
}

/** Max-of-factors mapping. Overridable via cfg.security.risk.tiers (partial). */
function mapTier(f, cfg = {}) {
  const t = cfg.security?.risk?.tiers || {};
  if (f.reversibility === "irreversible") return t.irreversible || "critical";
  if (f.impact === "read") return t.read || "safe";
  if (f.impact === "write" && f.scope === "workspace") return t.workspaceWrite || "low";
  if (f.impact === "egress") return t.egress || "risky";
  if (f.impact === "exec") {
    // workspace-scoped exec in a recoverable context is the bread and butter
    // of autonomous engineering — risky only when recovery is absent
    if (f.scope === "workspace" && f.recovery !== "none") return t.workspaceExec || "risky";
    return t.exec || "risky";
  }
  return t.default || "risky";
}
