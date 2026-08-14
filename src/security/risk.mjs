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

// Irreversible command facts — each entry is (pattern, reason). Patterns run
// against a NORMALIZED command (quotes/backslashes stripped, whitespace
// collapsed) so quoting/spacing tricks don't evade them.
const IRREVERSIBLE_CMD = [
  // force-push: -f or --force, any order
  [/\bgit\s+push\b[^|&;]*\s(-f\b|--force\b|--force-with-lease\b)/, "git force-push rewrites remote history"],
  [/\bgit\s+reset\s+--hard\b/, "hard reset discards work"],
  [/\bgit\s+clean\s+-\w*[fd]/, "git clean deletes untracked files"],
  [/\b(npm|yarn|pnpm)\s+publish\b/, "package publish is public"],
  [/\bgh\s+release\s+create\b/, "public release"],
  // pipe-to-shell in any decode form (curl|sh, base64 -d|bash, cat x|sh, …)
  [/\|\s*(ba|z|da|k|c|tc)?sh\b/, "pipe-to-shell executes arbitrary code"],
  [/\b(curl|wget|fetch)\b[^|&;]*(-o\s*\S+|>\s*\S+)[^|&;]*(;|&&|\|\|)\s*(ba|z|da)?sh\b/, "download-then-run"],
  [/\bdd\b[^|]*\bof=\/dev\//, "raw device write"],
  [/\bmkfs\b/, "filesystem format"],
  [/\b(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b/, "host power state"],
  [/\bpm2\s+(delete|kill|stop)\b/, "stops/removes supervised services"],
  [/\b(systemctl|service)\s+(stop|disable|mask)\b/, "stops system services"],
  [/\bdocker\s+(system\s+prune|rmi|rm\b)/, "destroys images/containers"],
  [/\bDROP\s+(TABLE|DATABASE)\b/i, "destructive SQL"],
  [/\bchmod\s+-R\b|\bchown\s+-R\b/, "recursive permission/ownership change"],
  // writes into system paths via redirect/tee/cp/mv/install (space-tolerant)
  [/(?:>>?|\btee\b|\bcp\b|\bmv\b|\binstall\b)\s*\/(?:etc|usr\/(?:bin|sbin|lib)|bin|sbin|boot|lib\/systemd|root\/\.ssh)\b/, "writes to system path"],
];

// Recursive-delete detection — flag-form-agnostic (-rf, -fr, -r -f,
// --recursive --force) and root/system-target aware.
const RM_RECURSIVE =
  /\brm\b[^|&;]*?(\s-\w*[rf]\w*|\s--recursive|\s--force)[^|&;]*?(\s-\w*[rf]\w*|\s--recursive|\s--force)?/;
const ROOTISH_TARGET =
  /\brm\b[^|&;]*\s(-{0,2}[\w-]+\s+)*(\/(?:\s|$|\*)|\/(?:etc|usr|bin|boot|lib|var|root|home|opt|sys|proc)\b|~\/?(?:\s|$)|\$HOME\b|\$\{HOME\})/;

const CREDENTIAL_PATH_RE = /\.ssh\/|credentials|\.env(\.|$)|secrets?\.|\.pem$|id_rsa|oauth|token/i;

/**
 * Read-only exec classification — the safe direction the tier table lacked.
 * Live observation (2026-08-14): every DM diagnostic (`pm2 list`, `tail`,
 * `cat`, `df -h`) tiered "risky" and pended 5min identically to `curl evil`,
 * making autoApproveMaxTier useless for channel bots. Deterministic and
 * FAIL-CLOSED: anything not provably read-only stays on the normal exec path.
 * Verified read-only exec maps to tier "low", never "safe" — reads can still
 * exfiltrate (and credential-path reads stay critical via the facts above).
 */
const READONLY_HEADS = new Set([
  "ls", "cat", "head", "tail", "less", "more", "grep", "egrep", "fgrep", "rg",
  "wc", "sort", "uniq", "cut", "tr", "diff", "cmp", "comm", "file", "stat",
  "readlink", "realpath", "basename", "dirname", "tree", "nl", "tac", "column",
  "strings", "md5sum", "sha1sum", "sha256sum", "base64", "jq",
  "ps", "pgrep", "pstree", "df", "du", "free", "uptime", "w", "who", "whoami",
  "id", "groups", "hostname", "uname", "arch", "nproc", "lscpu", "lsblk",
  "lsof", "netstat", "ss", "date", "cal", "printenv", "pwd", "which",
  "whereis", "type", "echo", "printf", "true", "false", "test", "sleep",
  "journalctl", "dmesg",
]);

// Heads allowed only with a constrained first subcommand / flag shape.
const CONSTRAINED_HEADS = {
  git: new Set(["status", "log", "diff", "show", "rev-parse", "ls-files", "blame", "grep", "describe", "shortlog"]),
  pm2: new Set(["list", "ls", "jlist", "status", "describe", "info", "show", "prettylist", "report", "id"]),
  npm: new Set(["ls", "list", "view", "info", "ping", "outdated", "root", "prefix"]),
  systemctl: new Set(["status", "show", "list-units", "list-timers", "is-active", "is-enabled", "is-failed", "cat"]),
};

const FIND_MUTATORS = /-(delete|exec|execdir|ok|okdir|fprint|fprintf|fls)\b/;
const JOURNALCTL_MUTATORS = /--(vacuum|rotate|flush)/;

function segmentIsReadOnly(segment) {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true; // empty side of a separator
  const head = tokens[0];
  if (head.includes("/") || head.includes("=")) return false; // path heads / env prefixes: fail closed
  if (head === "find") return !FIND_MUTATORS.test(segment);
  if (head === "journalctl") return !JOURNALCTL_MUTATORS.test(segment);
  if (head === "env") return tokens.length === 1; // bare env lists; `env X cmd` runs cmd
  if (head === "crontab") return tokens.length === 2 && tokens[1] === "-l";
  const constrained = CONSTRAINED_HEADS[head];
  if (constrained) {
    const sub = tokens.slice(1).find((t) => !t.startsWith("-"));
    // pm2 logs tails forever unless --nostream; with it, it's a bounded read
    // (live-observed: `pm2 logs sudo-ai-v5 --err --lines 50 --nostream`)
    if (head === "pm2" && sub === "logs") return /--nostream\b/.test(segment);
    return Boolean(sub && constrained.has(sub));
  }
  return READONLY_HEADS.has(head);
}

/** True only when every pipeline/chain segment is a provably read-only command. */
export function isReadOnlyExecCommand(cmdRaw) {
  let cmd = String(cmdRaw || "").trim();
  if (!cmd) return false;
  // Harmless stream redirects don't disqualify: fd duplication (2>&1) and
  // /dev/null sinks mutate nothing. Live-observed: `pm2 describe x 2>&1 |
  // head -50` — the single most common diagnostic idiom — was pending on
  // the raw `>` gate. Strip ONLY these exact forms before the gate.
  cmd = cmd
    .replace(/\d?\s*>\s*&\s*\d(?!\S)/g, " ")
    .replace(/\d?\s*>{1,2}\s*\/dev\/null(?![\w.-])/g, " ")
    .replace(/<\s*\/dev\/null(?![\w.-])/g, " ");
  // structure gate on the remaining string: redirections, substitutions,
  // subshells, and here-docs disqualify outright (a `>` inside a quoted grep
  // pattern false-positives to the normal exec path — fail-closed, costs a
  // prompt)
  if (/[><]|\$\(|`|\(/.test(cmd)) return false;
  const segments = cmd.split(/\|\||&&|;|\||&|\n/);
  return segments.every(segmentIsReadOnly);
}

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

/**
 * Normalize a shell command for pattern matching: drop quotes and backslashes
 * (so `"/etc"`, `s""rc`, `\/etc` all collapse to their literal form) and
 * squeeze whitespace. Used ONLY for danger detection — never for execution.
 */
function normalizeCommand(cmd) {
  return String(cmd || "")
    .replace(/["'`\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

  const cmdRaw = impact === "exec" ? commandText(args) : "";
  const cmd = normalizeCommand(cmdRaw);
  const paths = extractPaths(args);

  // scope from resolved path operands (+ command path mentions for exec).
  // The scanner now also catches quoted/tilde/$HOME forms after normalization.
  const scopes = paths.map((p) => classifyScope(p, workingDir));
  if (cmd) {
    const homeExpanded = cmd
      .replace(/\$\{?HOME\}?/g, os.homedir())
      .replace(/(^|\s)~(?=\/|\s|$)/g, `$1${os.homedir()}`);
    for (const m of homeExpanded.matchAll(/(?:^|\s)(\/[\w./-]*)/g)) {
      scopes.push(classifyScope(m[1] || "/", workingDir));
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
    // Recursive/forced delete, flag-form-agnostic. A root/system/home target
    // is unconditionally irreversible; otherwise scope decides (workspace
    // build-dir deletes stay routine).
    if (reversibility !== "irreversible" && RM_RECURSIVE.test(cmd)) {
      if (ROOTISH_TARGET.test(cmd)) {
        reversibility = "irreversible";
        reasons.push("recursive delete of root/system/home target");
      } else if (scope !== "workspace") {
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

  // read-only exec: provably non-mutating command chains rank "low" instead
  // of the blanket exec tier. Computed AFTER the danger facts so an
  // irreversible/credential finding always wins in mapTier.
  let readOnlyExec = false;
  if (impact === "exec" && cmdRaw && isReadOnlyExecCommand(cmdRaw)) {
    readOnlyExec = true;
    reasons.push("read-only diagnostic command");
  }

  const factors = { scope, impact, reversibility, blastRadius, recovery, readOnlyExec };
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
    // provably read-only command chains (any scope): reads can exfiltrate,
    // so "low" — never "safe"; credential-path reads never reach here
    // (irreversible wins above)
    if (f.readOnlyExec) return t.readOnlyExec || "low";
    // workspace-scoped exec in a recoverable context is the bread and butter
    // of autonomous engineering — risky only when recovery is absent
    if (f.scope === "workspace" && f.recovery !== "none") return t.workspaceExec || "risky";
    return t.exec || "risky";
  }
  return t.default || "risky";
}
