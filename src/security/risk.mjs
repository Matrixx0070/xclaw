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
const EXEC_RE = /bash|shell|exec|terminal|run|spawn|python|jupyter|kernel/i;
const EGRESS_RE = /web_|fetch|http|browser|navigate|download|upload|api/i;

// Every family regex above is an unanchored substring match. That is sound for
// xclaw's own 45 tool names, which it chose, and unsound for the third-party
// names an MCP server supplies, which it did not: "thread" contains "read",
// and `impact: "read"` is the ONLY route to the `safe` tier. So a read
// certificate for a name we did not choose has to be EARNED at the leading
// verb of the operation; anything else keeps the fail-closed `exec` default.
// This runs both ways on the live surface — Linear names every mutation
// `save_*` and every reader `get_*`, and `get` appears in no family regex at
// all, so the substring rule tiered 15 pure reads ABOVE 2 real mutations.
const MCP_READ_VERB_RE = /^(get|list|read|search|fetch|describe|show|query|find|lookup)_/;

function isReadFamilyName(name) {
  if (name.startsWith("mcp__")) return MCP_READ_VERB_RE.test(name.split("__").pop());
  return READ_RE.test(name);
}

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

/**
 * Quote-aware command scanner (classifier v2). The regex classifier false-
 * pended real audit traffic — `cd X && cat Y`, `sed -n '1,120p' f`,
 * `awk 'NR>=6 && NR<=30' f`, `grep "TODO|FIXME" src` — because it could not
 * tell quoted (inert) metacharacters from active ones. Bash semantics
 * modeled: single-quoted text is fully inert; inside double quotes `$(` and
 * backtick still substitute but `>` `<` `|` `;` `&` are inert; a backslash
 * escapes the next char. Splits on |, ||, &&, ;, &, newline OUTSIDE quotes
 * only. Anything ambiguous (unterminated quote, subshell, remaining
 * redirect) → unsafe, fail closed.
 */
export function scanCommand(raw) {
  const segments = [];
  let cur = "";
  let inS = false;
  let inD = false;
  let unsafe = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    const n = raw[i + 1];
    if (inS) {
      if (c === "'") inS = false;
      cur += c;
      continue;
    }
    if (inD) {
      if (c === '"') inD = false;
      else if (c === "`" || (c === "$" && n === "(")) unsafe = true;
      else if (c === "\\") {
        cur += c + (raw[++i] ?? "");
        continue;
      }
      cur += c;
      continue;
    }
    if (c === "'") { inS = true; cur += c; continue; }
    if (c === '"') { inD = true; cur += c; continue; }
    if (c === "\\") { cur += c + (raw[++i] ?? ""); continue; }
    if (c === "`" || (c === "$" && n === "(") || c === "(" || c === ">" || c === "<") {
      unsafe = true;
      cur += c;
      continue;
    }
    if (c === "|" || c === ";" || c === "&" || c === "\n") {
      segments.push(cur);
      cur = "";
      if ((c === "|" || c === "&") && n === c) i++;
      continue;
    }
    cur += c;
  }
  if (inS || inD) unsafe = true; // unterminated quote
  segments.push(cur);
  return { segments, unsafe };
}

/** Tokenize a segment: whitespace-split, quoted spans stay single tokens. */
function tokenizeSegment(segment) {
  return segment.match(/(?:[^\s'"]+|'[^']*'|"(?:[^"\\]|\\.)*")+/g) || [];
}

function unquote(t) {
  if (t.length >= 2 && ((t[0] === "'" && t.at(-1) === "'") || (t[0] === '"' && t.at(-1) === '"'))) {
    return t.slice(1, -1);
  }
  return t;
}

// sed: only the print-slice shape (`sed -n '1,120p' file`) — live-observed
// as the standard file-range read. -i/-f/-s and any non-range program reject.
function sedIsReadOnly(tokens) {
  const flags = tokens.slice(1).filter((t) => t.startsWith("-"));
  if (flags.some((f) => /^-(i|s|f|-in-place|-file|-separate)/.test(f))) return false;
  const rest = tokens.slice(1).filter((t) => !t.startsWith("-"));
  if (!rest.length) return false;
  const program = unquote(rest[0]);
  return /^[0-9,$;\s]*p$/.test(program); // pure print ranges only
}

// awk: inline single-quoted program only; comparisons (>=, <=) are fine but
// any residual > < (output redirect / cmd pipe) or system/getline rejects.
function awkIsReadOnly(tokens) {
  if (tokens.slice(1).some((t) => /^-(f|e|-file)/.test(t))) return false;
  const rest = tokens.slice(1).filter((t) => !t.startsWith("-"));
  if (!rest.length) return false;
  const prog = rest[0];
  if (!(prog.startsWith("'") && prog.endsWith("'"))) return false;
  const body = prog.slice(1, -1);
  if (/\b(system|getline|close|ENVIRON\s*\[.*\]\s*=)\b/.test(body)) return false;
  const noCmp = body.replace(/>=|<=|==|!=/g, "");
  return !/[<>|]/.test(noCmp);
}

function segmentIsReadOnly(segment) {
  const tokens = tokenizeSegment(segment.trim());
  if (!tokens.length) return true; // empty side of a separator
  const head = tokens[0];
  if (head.includes("/") || head.includes("=") || head.includes("'") || head.includes('"')) {
    return false; // path heads / env prefixes / quoted heads: fail closed
  }
  // `<anything> --version` with no other args prints a version string and
  // exits — read-only regardless of head (live: `node --version` pended
  // 120s and stalled a mission segment; node itself stays excluded because
  // `node -e` executes arbitrary code).
  if (tokens.length === 2 && tokens[1] === "--version" && !head.startsWith("-")) return true;
  if (head === "cd") return true; // process-local; target already metachar-gated
  if (head === "sed") return sedIsReadOnly(tokens);
  if (head === "awk") return awkIsReadOnly(tokens);
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
  // /dev/null sinks mutate nothing. Strip ONLY these exact forms before the
  // scanner (boundary-guarded: 2>/dev/nullX is a real file write and stays).
  cmd = cmd
    .replace(/\d?\s*>\s*&\s*\d(?!\S)/g, " ")
    .replace(/\d?\s*>{1,2}\s*\/dev\/null(?![\w.-])/g, " ")
    .replace(/<\s*\/dev\/null(?![\w.-])/g, " ");
  const { segments, unsafe } = scanCommand(cmd);
  if (unsafe) return false;
  return segments.every(segmentIsReadOnly);
}

/**
 * Exhaustive path-bearing arg keys — SINGLE SOURCE (self/profile.mjs imports
 * this). The incomplete local copy this replaces caused a live BLOCKER
 * (2026-08-14): xclaw_file_write passes `file_path`, which extractPaths did
 * not inspect → no paths → scope defaulted "workspace" → an outside-
 * workspace write tiered "low" and AUTO-RAN under autoApproveMaxTier —
 * the same arg-key blind-spot class as the 3.122 edit-surface BLOCKER.
 */
export const PATH_ARG_KEYS = [
  "path", "file", "filepath", "file_path", "filePath", "filename", "fileName",
  "target", "dest", "destination", "to", "output", "outputPath", "out",
  "dir", "directory", "cwd", "workingDir",
  "old_path", "new_path", "oldPath", "newPath", "source", "src",
];

/**
 * S6b: the subset of PATH_ARG_KEYS that is SAFE TO REWRITE (sandbox path
 * resolution mutates args). Excludes keys that are only sometimes paths —
 * "target" (browser selectors), "to" (message recipients), "source"/"src"
 * (media URLs), bare "output"/"out" — rewriting those corrupts non-file
 * tools. The sandbox guard previously kept its OWN 7-key list that missed
 * file_path/filePath entirely, so file tools escaped the guard (audit
 * 2026-08-23: "guardToolPaths dead for file tools"). Single-sourced here.
 */
export const STRICT_PATH_ARG_KEYS = [
  "path", "file", "filepath", "file_path", "filePath", "filename", "fileName",
  "dir", "directory", "cwd", "workingDir",
  "old_path", "new_path", "oldPath", "newPath",
  "dest", "destination", "outputPath",
];

export function extractPaths(args = {}) {
  const out = [];
  for (const k of PATH_ARG_KEYS) {
    if (typeof args[k] === "string" && args[k]) out.push(args[k]);
  }
  return out;
}

export function commandText(args = {}) {
  // `code` covers exec tools that take source text (python_session) — their
  // payload gets the same danger-fact scan (credential paths, system paths)
  // as a shell command.
  return String(args.command ?? args.cmd ?? args.script ?? args.input ?? args.code ?? "");
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
  else if (isReadFamilyName(name)) impact = "read";
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
  // Fail-closed scope default: a WRITE tool whose target we cannot extract
  // must not silently count as workspace-scoped (that default is exactly how
  // the file_path blind spot auto-ran an outside-workspace write). Reads keep
  // the permissive default — worst case is a wasted read.
  let scope;
  if (scopes.length) {
    scope = worstScope(scopes);
  } else if (impact === "write") {
    scope = "home";
    reasons.push("write target unresolved — conservative scope");
  } else {
    scope = "workspace";
  }

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
    // Reads count too: exfiltrating a secret is a READ, and a read-family tool
    // (file_read/read_file) reaching an in-workspace .env / credentials.json is
    // NOT blocked by the sandbox (it guards workspace ESCAPE, not credential
    // sensitivity). Gating only write/exec left the most direct exfil path —
    // `file_read` of a secret — tiered "safe" and auto-approved. Egress is
    // deliberately excluded: browser/navigate target|to|source args legitimately
    // carry "token"/"oauth" substrings and would false-positive.
    (impact === "write" || impact === "exec" || impact === "read") &&
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
