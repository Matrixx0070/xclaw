/* Strategy C3 GENERATED — do not hand-edit. Full CDP remains xclaw-server.mjs */

// src/computer/thin-server.mjs
import http2 from "node:http";
import crypto3 from "node:crypto";

// src/computer/modules/bash-tool.mjs
import { spawn } from "node:child_process";
import path3 from "node:path";
import os from "node:os";
import fs4 from "node:fs/promises";
import crypto2 from "node:crypto";

// src/security/spawn-enforce.mjs
import fs2 from "node:fs";
import path from "node:path";

// src/security/system-run-plan.mjs
import crypto from "node:crypto";
import fs from "node:fs";
var PLAN_VERSION = 1;
function tryRealpath(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
  } catch {
    return null;
  }
}
function tryContentHash(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}
function planFingerprint(plan) {
  const payload = {
    v: plan.version ?? PLAN_VERSION,
    tool: plan.tool,
    argv: plan.argv || [],
    cwd: plan.cwd,
    exe: plan.exe,
    files: (plan.fileOperands || []).map((f) => ({
      p: f.path,
      h: f.hash
    }))
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}
function revalidatePlan(plan) {
  if (!plan || plan.version !== PLAN_VERSION) {
    return { ok: false, reason: "invalid_plan", message: "plan missing or version mismatch" };
  }
  const drift = {};
  if (plan.cwd) {
    const now = tryRealpath(plan.pins?.cwdResolved || plan.cwd) || plan.cwd;
    if (now !== plan.cwd) {
      drift.cwd = { expected: plan.cwd, actual: now };
    }
  }
  if (plan.exe && plan.pins?.exeResolved) {
    const now = tryRealpath(plan.pins.exeResolved);
    if (now && plan.exe && now !== plan.exe) {
      drift.exe = { expected: plan.exe, actual: now };
    }
  }
  for (const f of plan.fileOperands || []) {
    if (!f.hash) continue;
    const nowHash = tryContentHash(f.path);
    if (nowHash && nowHash !== f.hash) {
      drift[`file:${f.key || f.path}`] = {
        expected: f.hash,
        actual: nowHash
      };
    }
  }
  if (Object.keys(drift).length > 0) {
    return {
      ok: false,
      reason: "plan_drift",
      message: "Execution environment drifted after approval (TOCTOU).",
      drift
    };
  }
  const current = planFingerprint(plan);
  if (plan.fingerprint && current !== plan.fingerprint) {
    return {
      ok: false,
      reason: "fingerprint_mismatch",
      message: "Plan fingerprint no longer matches frozen plan."
    };
  }
  return { ok: true };
}

// src/security/spawn-enforce.mjs
function tryRealpath2(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return fs2.realpathSync.native ? fs2.realpathSync.native(value) : fs2.realpathSync(value);
  } catch {
    return null;
  }
}
function getSpawnEnforceMode(cfg = {}) {
  const env = String(process.env.XCLAW_SPAWN_ENFORCE || "").toLowerCase();
  if (env === "off" || env === "0" || env === "false") return "off";
  if (env === "strict" || env === "1" || env === "true") return "strict";
  if (env === "check") return "check";
  const m = String(cfg?.security?.spawnEnforce || cfg?.spawnEnforce || "").toLowerCase();
  if (m === "off" || m === "check" || m === "strict") return m;
  if ((cfg?.profile || process.env.XCLAW_PROFILE) === "prod") return "check";
  return "check";
}
function assertPlanAtSpawn({ plan, command, cwd, mode = "check" } = {}) {
  if (mode === "off") {
    return {
      ok: true,
      command: String(command || ""),
      cwd: cwd || process.cwd(),
      enforced: false
    };
  }
  if (!plan) {
    if (mode === "strict") {
      return {
        ok: false,
        reason: "missing_plan",
        error: "spawn enforce strict: systemRunPlan required for exec"
      };
    }
    return {
      ok: true,
      command: String(command || ""),
      cwd: cwd || process.cwd(),
      enforced: false
    };
  }
  if (plan.version != null && plan.version !== PLAN_VERSION) {
    return {
      ok: false,
      reason: "plan_version",
      error: `spawn enforce: plan version mismatch (got ${plan.version})`
    };
  }
  const rv = revalidatePlan(plan);
  if (!rv.ok) {
    return {
      ok: false,
      reason: rv.reason || "plan_drift",
      error: `spawn enforce: ${rv.message || rv.reason}`,
      drift: rv.drift
    };
  }
  const frozenCmd = String(plan.command ?? "");
  const liveCmd = String(command ?? "");
  if (frozenCmd !== liveCmd) {
    return {
      ok: false,
      reason: "command_mismatch",
      error: "spawn enforce: live command does not match frozen plan.command (refusing mutated args)",
      expected: frozenCmd.slice(0, 200),
      actual: liveCmd.slice(0, 200)
    };
  }
  const fp = planFingerprint(plan);
  if (plan.fingerprint && fp !== plan.fingerprint) {
    return {
      ok: false,
      reason: "fingerprint_mismatch",
      error: "spawn enforce: plan fingerprint mismatch at spawn"
    };
  }
  let runCwd = plan.cwd || cwd || process.cwd();
  if (cwd && plan.cwd) {
    const live = tryRealpath2(path.resolve(cwd)) || path.resolve(cwd);
    const pin = tryRealpath2(plan.cwd) || plan.cwd;
    if (live !== pin) {
      return {
        ok: false,
        reason: "cwd_mismatch",
        error: `spawn enforce: cwd drift at spawn (plan=${pin} live=${live})`
      };
    }
    runCwd = pin;
  }
  return {
    ok: true,
    command: frozenCmd,
    cwd: runCwd,
    enforced: true,
    planFingerprint: plan.fingerprint
  };
}
function buildEnforcedBashSpawn({ plan, command, cwd, env } = {}) {
  const bashCandidates = ["/bin/bash", "/usr/bin/bash"];
  let bash = "/bin/bash";
  for (const c of bashCandidates) {
    const real = tryRealpath2(c);
    if (real) {
      bash = real;
      break;
    }
  }
  if (plan?.exe && /bash$/.test(String(plan.exe))) {
    const real = tryRealpath2(plan.exe) || plan.exe;
    bash = real;
  }
  const cmd = plan?.command != null ? String(plan.command) : String(command || "");
  const runCwd = plan?.cwd || cwd || process.cwd();
  const base = { ...env || process.env };
  delete base.BASH_ENV;
  delete base.ENV;
  base.BASH_ENV = "";
  base.ENV = "";
  return {
    exe: bash,
    // -c only (NOT -lc): no login profile, PATH stays closer to spawn env
    argv: ["-c", cmd],
    cwd: runCwd,
    env: base,
    shell: false
  };
}

// src/security/os-sandbox.mjs
import { spawnSync } from "node:child_process";
import fs3 from "node:fs";
import path2 from "node:path";

// src/security/egress.mjs
function getEgressPolicy(cfg = {}) {
  const eg = cfg?.security?.egress || cfg?.egress || {};
  const envMode = process.env.XCLAW_EGRESS;
  let mode = String(envMode || eg.mode || "").toLowerCase();
  if (!mode) {
    const profile = process.env.XCLAW_PROFILE || cfg?.profile || "lab";
    mode = profile === "prod" ? "deny" : "allow";
  }
  if (!["allow", "deny", "allowlist"].includes(mode)) mode = "allow";
  const allowHosts = (eg.allowHosts || []).map((h) => String(h).toLowerCase());
  const denyExtra = (eg.denyCommands || []).map((s) => {
    try {
      return new RegExp(s, "i");
    } catch {
      return null;
    }
  }).filter(Boolean);
  return { mode, allowHosts, denyExtra };
}

// src/security/os-sandbox.mjs
var _bwrapPath = void 0;
function findBwrap() {
  if (_bwrapPath !== void 0) return _bwrapPath;
  const env = process.env.XCLAW_BWRAP;
  if (env && fs3.existsSync(env)) {
    _bwrapPath = env;
    return _bwrapPath;
  }
  for (const c of ["bwrap", "/usr/bin/bwrap", "/bin/bwrap"]) {
    try {
      const r = spawnSync(c === "bwrap" ? "bwrap" : c, ["--version"], {
        encoding: "utf8",
        timeout: 3e3
      });
      if (r.status === 0) {
        _bwrapPath = c === "bwrap" ? "bwrap" : c;
        return _bwrapPath;
      }
    } catch {
    }
  }
  _bwrapPath = null;
  return null;
}
var _bwrapWorks = void 0;
function probeBwrapWorks() {
  if (_bwrapWorks !== void 0) return _bwrapWorks;
  const bwrap = findBwrap();
  if (!bwrap) {
    _bwrapWorks = false;
    return false;
  }
  const cwd = process.cwd();
  const args = [
    "--die-with-parent",
    "--ro-bind",
    "/usr",
    "/usr",
    "--bind",
    cwd,
    cwd,
    "--chdir",
    cwd,
    "--",
    "/bin/true"
  ];
  try {
    if (fs3.existsSync("/bin") && fs3.realpathSync("/bin") !== fs3.realpathSync("/usr")) {
      args.splice(1, 0, "--ro-bind", "/bin", "/bin");
    }
  } catch {
  }
  try {
    const r = spawnSync(bwrap, args, { encoding: "utf8", timeout: 5e3 });
    _bwrapWorks = r.status === 0;
    if (!_bwrapWorks) {
      probeBwrapWorks.lastError = String(r.stderr || r.stdout || r.error || "bwrap probe failed");
    }
  } catch (e) {
    _bwrapWorks = false;
    probeBwrapWorks.lastError = String(e?.message || e);
  }
  return _bwrapWorks;
}
function getOsSandboxMode(cfg = {}) {
  const env = String(process.env.XCLAW_OS_SANDBOX || "").toLowerCase();
  if (env === "off" || env === "0" || env === "false") return "off";
  if (env === "bwrap" || env === "on" || env === "1" || env === "true") return "bwrap";
  if (env === "auto") return "auto";
  const m = String(
    cfg?.security?.osSandbox || cfg?.osSandbox || ""
  ).toLowerCase();
  if (m === "off" || m === "bwrap" || m === "auto") return m;
  return "auto";
}
var _bwrapNetnsWorks = void 0;
function probeBwrapNetns() {
  if (_bwrapNetnsWorks !== void 0) return _bwrapNetnsWorks;
  const bwrap = findBwrap();
  if (!bwrap || !probeBwrapWorks()) {
    _bwrapNetnsWorks = false;
    return false;
  }
  const cwd = process.cwd();
  try {
    const r = spawnSync(
      bwrap,
      [
        "--die-with-parent",
        "--unshare-net",
        "--ro-bind",
        "/usr",
        "/usr",
        "--bind",
        cwd,
        cwd,
        "--chdir",
        cwd,
        "--",
        "/bin/true"
      ],
      { encoding: "utf8", timeout: 5e3 }
    );
    _bwrapNetnsWorks = r.status === 0;
    if (!_bwrapNetnsWorks) {
      probeBwrapNetns.lastError = String(r.stderr || r.stdout || r.error || "bwrap netns probe failed");
    }
  } catch (e) {
    _bwrapNetnsWorks = false;
    probeBwrapNetns.lastError = String(e?.message || e);
  }
  return _bwrapNetnsWorks;
}
function shouldUnshareNet(cfg) {
  if (cfg?.security?.osSandboxUnshareNet === false) return false;
  if (cfg?.security?.osSandboxUnshareNet === true) return true;
  if (process.env.XCLAW_OS_SANDBOX_NET === "allow") return false;
  if (process.env.XCLAW_OS_SANDBOX_NET === "deny") return true;
  return getEgressPolicy(cfg).mode !== "allow";
}
function buildBwrapArgv({
  cfg = {},
  cwd,
  workspace
} = {}) {
  const mode = getOsSandboxMode(cfg);
  if (mode === "off") {
    return { ok: false, reason: "disabled" };
  }
  const bwrap = findBwrap();
  if (!bwrap) {
    if (mode === "bwrap") {
      return {
        ok: false,
        reason: "bwrap_missing",
        error: "security.osSandbox=bwrap but bubblewrap is not installed (apt install bubblewrap)"
      };
    }
    return { ok: false, reason: "bwrap_unavailable" };
  }
  const ws = path2.resolve(workspace || cwd || process.cwd());
  const runCwd = path2.resolve(cwd || ws);
  const argv = [
    "--die-with-parent",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp"
  ];
  const roDirs = [
    "/usr",
    "/etc",
    "/bin",
    "/sbin",
    "/lib",
    "/lib64",
    "/lib32",
    ...cfg?.security?.osSandboxExtraRo || []
  ];
  const bound = /* @__PURE__ */ new Set();
  for (const d of roDirs) {
    try {
      if (!fs3.existsSync(d)) continue;
      let real = d;
      try {
        real = fs3.realpathSync(d);
      } catch {
      }
      if (bound.has(real)) continue;
      argv.push("--ro-bind", d, d);
      bound.add(real);
      bound.add(d);
    } catch {
    }
  }
  argv.push("--bind", ws, ws);
  if (runCwd !== ws && !runCwd.startsWith(ws + path2.sep)) {
    try {
      if (fs3.existsSync(runCwd)) argv.push("--bind", runCwd, runCwd);
    } catch {
    }
  }
  argv.push("--chdir", runCwd);
  let netIsolated = false;
  let netnsDegraded = false;
  if (shouldUnshareNet(cfg)) {
    if (probeBwrapNetns()) {
      argv.push("--unshare-net");
      netIsolated = true;
    } else {
      netnsDegraded = true;
    }
  }
  argv.push("--unshare-pid");
  return {
    ok: true,
    bwrap,
    argvPrefix: argv,
    workspace: ws,
    cwd: runCwd,
    netIsolated,
    netnsDegraded
  };
}
function wrapSpawnWithOsSandbox(spec, { cfg, workspace } = {}) {
  const mode = getOsSandboxMode(cfg);
  if (mode !== "off" && findBwrap() && !probeBwrapWorks()) {
    if (mode === "bwrap") {
      return {
        ...spec,
        sandboxed: false,
        deny: true,
        reason: "bwrap_unusable",
        error: probeBwrapWorks.lastError || "bwrap installed but cannot create sandbox (uid map denied?)"
      };
    }
    return {
      exe: spec.exe,
      argv: spec.argv,
      cwd: spec.cwd,
      env: spec.env,
      sandboxed: false,
      reason: "bwrap_unusable_fallback"
    };
  }
  const built = buildBwrapArgv({
    cfg,
    cwd: spec.cwd,
    workspace: workspace || spec.cwd
  });
  if (!built.ok) {
    if (built.reason === "bwrap_missing") {
      return {
        ...spec,
        sandboxed: false,
        deny: true,
        reason: built.reason,
        error: built.error
      };
    }
    return {
      exe: spec.exe,
      argv: spec.argv,
      cwd: spec.cwd,
      env: spec.env,
      sandboxed: false,
      reason: built.reason || "off"
    };
  }
  return {
    exe: built.bwrap,
    argv: [...built.argvPrefix, "--", spec.exe, ...spec.argv],
    cwd: spec.cwd,
    // bwrap --chdir handles inside
    env: spec.env,
    sandboxed: true,
    netIsolated: Boolean(built.netIsolated),
    netnsDegraded: Boolean(built.netnsDegraded),
    reason: "bwrap"
  };
}

// src/security/env-policy.mjs
var SECRET_NAME_RE = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE_KEY|ACCESS_KEY|SESSION_?(ID|KEY)|COOKIE|_AUTH|AUTH_|WEBHOOK)/i;
var BASE_ALLOW = /* @__PURE__ */ new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LANGUAGE",
  "TZ",
  "TMPDIR",
  "PWD",
  "COLUMNS",
  "LINES",
  "NODE_ENV",
  "CI"
]);
var ALLOW_PREFIXES = ["LC_"];
function getEnvPolicyMode(cfg = {}) {
  const env = String(process.env.XCLAW_BASH_ENV || "").toLowerCase();
  if (env === "inherit" || env === "allowlist" || env === "strip-secrets") return env;
  const m = String(cfg?.security?.bashEnv || "").toLowerCase();
  if (m === "inherit" || m === "allowlist" || m === "strip-secrets") return m;
  return "strip-secrets";
}
function buildToolEnv(cfg = {}, sourceEnv = process.env) {
  const mode = getEnvPolicyMode(cfg);
  const allowExtra = new Set(
    (cfg?.security?.envAllow || []).map((s) => String(s))
  );
  const denyExtra = new Set((cfg?.security?.envDeny || []).map((s) => String(s)));
  const out = {};
  const stripped = [];
  for (const [k, v] of Object.entries(sourceEnv)) {
    if (v == null) continue;
    if (denyExtra.has(k)) {
      stripped.push(k);
      continue;
    }
    if (allowExtra.has(k)) {
      out[k] = v;
      continue;
    }
    if (mode === "inherit") {
      out[k] = v;
      continue;
    }
    if (mode === "allowlist") {
      if (BASE_ALLOW.has(k) || ALLOW_PREFIXES.some((p) => k.startsWith(p))) {
        out[k] = v;
      } else {
        stripped.push(k);
      }
      continue;
    }
    if (SECRET_NAME_RE.test(k)) {
      stripped.push(k);
    } else {
      out[k] = v;
    }
  }
  return { env: out, mode, stripped };
}

// src/computer/modules/bash-tool.mjs
var DEFAULT_TIMEOUT_SECONDS = 30;
async function executeBash(input = {}, ctx = {}) {
  let command = String(input.command || "");
  if (!command.trim()) {
    return { ok: false, stdout: "", stderr: "command is required", exitCode: 1 };
  }
  const plan = input.systemRunPlan || input.plan || ctx.systemRunPlan || ctx.plan || null;
  const mode = getSpawnEnforceMode(ctx.cfg || {});
  const check = assertPlanAtSpawn({
    plan,
    command,
    cwd: ctx.cwd || input.cwd,
    mode: plan ? mode : mode === "strict" ? "strict" : "off"
  });
  if (!check.ok) {
    return {
      ok: false,
      stdout: "",
      stderr: check.error || "spawn enforce denied",
      exitCode: 126,
      blocked: true,
      reason: check.reason || "spawn_enforce"
    };
  }
  command = check.command || command;
  const timeoutSec = Number(input.timeout ?? DEFAULT_TIMEOUT_SECONDS);
  const timeoutMs = Math.min(12e4, Math.max(0, timeoutSec * 1e3));
  const cwd = check.cwd || ctx.cwd || process.cwd();
  const background = Boolean(input.background);
  const envPolicy = buildToolEnv(ctx.cfg || {});
  const spawnEnv = { ...envPolicy.env };
  spawnEnv.BASH_ENV = "";
  spawnEnv.ENV = "";
  const useEnforceSpawn = Boolean(check.enforced || plan);
  const loginShell = ctx.cfg?.security?.bashLogin === true;
  let spec = useEnforceSpawn ? buildEnforcedBashSpawn({ plan, command, cwd, env: spawnEnv }) : {
    exe: "/bin/bash",
    argv: [loginShell ? "-lc" : "-c", command],
    cwd,
    env: spawnEnv
  };
  const wrapped = wrapSpawnWithOsSandbox(spec, {
    cfg: ctx.cfg || {},
    workspace: ctx.workspace || ctx.cwd || cwd
  });
  if (wrapped.deny) {
    return {
      ok: false,
      stdout: "",
      stderr: wrapped.error || "os sandbox denied",
      exitCode: 126,
      blocked: true,
      reason: wrapped.reason || "os_sandbox"
    };
  }
  spec = wrapped;
  const osSandboxed = Boolean(wrapped.sandboxed);
  if (background) {
    const logDir = path3.join(os.tmpdir(), "xclaw-bash-bg");
    await fs4.mkdir(logDir, { recursive: true });
    const logFile = path3.join(logDir, `${crypto2.randomBytes(6).toString("hex")}.log`);
    const logFd = await fs4.open(logFile, "w");
    const child = spawn(spec.exe, spec.argv, {
      cwd: spec.cwd,
      detached: true,
      stdio: ["ignore", logFd.fd, logFd.fd],
      env: spec.env
    });
    child.unref();
    await logFd.close();
    return {
      ok: true,
      pid: child.pid,
      logFile,
      stdout: "",
      stderr: "",
      timedOut: false,
      interrupted: false,
      spawnEnforced: Boolean(check.enforced),
      osSandboxed,
      netIsolated: Boolean(wrapped.netIsolated),
      envPolicy: envPolicy.mode
    };
  }
  return new Promise((resolve) => {
    const child = spawn(spec.exe, spec.argv, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let interrupted = false;
    const max = 2e6;
    child.stdout.on("data", (c) => {
      if (stdout.length < max) stdout += c.toString();
    });
    child.stderr.on("data", (c) => {
      if (stderr.length < max) stderr += c.toString();
    });
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {
        }
      }, timeoutMs);
    }
    const onAbort = () => {
      interrupted = true;
      try {
        child.kill("SIGKILL");
      } catch {
      }
    };
    if (ctx.signal) {
      if (ctx.signal.aborted) onAbort();
      else ctx.signal.addEventListener("abort", onAbort, { once: true });
    }
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: !timedOut && !interrupted && code === 0,
        stdout,
        stderr,
        exitCode: code ?? 1,
        timedOut,
        interrupted,
        spawnEnforced: Boolean(check.enforced),
        osSandboxed,
        netIsolated: Boolean(wrapped.netIsolated),
        envPolicy: envPolicy.mode
      });
    });
  });
}
var BashTool = {
  name: "xclaw_bash",
  description: "Executes a given bash command in a fresh shell at the session working directory.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Bash command to run" },
      timeout: { type: "number", description: "Timeout seconds" },
      background: { type: "boolean" }
    },
    required: ["command"]
  },
  execute: executeBash,
  call: async (args, ctx) => executeBash(args, ctx)
};

// src/computer/modules/file-tools.mjs
import fs5 from "node:fs/promises";
import path4 from "node:path";
function resolveSafe(cwd, filePath) {
  const root2 = path4.resolve(cwd || process.cwd());
  const target = path4.resolve(root2, filePath);
  if (!target.startsWith(root2 + path4.sep) && target !== root2) {
    const err = new Error(`Path escapes workspace: ${filePath}`);
    err.code = "E_SANDBOX";
    throw err;
  }
  return target;
}
async function fileRead(input = {}, ctx = {}) {
  const cwd = ctx.cwd || process.cwd();
  const target = resolveSafe(cwd, input.path || input.file_path);
  const content = await fs5.readFile(target, "utf8");
  const offset = Math.max(1, Number(input.offset) || 1);
  const limit = Number(input.limit) || 2e3;
  const lines = content.split("\n");
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  return {
    ok: true,
    path: target,
    content: slice.join("\n"),
    totalLines: lines.length,
    offset,
    limit
  };
}
async function fileWrite(input = {}, ctx = {}) {
  const cwd = ctx.cwd || process.cwd();
  const target = resolveSafe(cwd, input.path || input.file_path);
  await fs5.mkdir(path4.dirname(target), { recursive: true });
  const content = input.content ?? "";
  await fs5.writeFile(target, content, "utf8");
  return {
    ok: true,
    path: target,
    bytes: Buffer.byteLength(String(content), "utf8")
  };
}
async function fileEdit(input = {}, ctx = {}) {
  const cwd = ctx.cwd || process.cwd();
  const target = resolveSafe(cwd, input.path || input.file_path);
  let text = await fs5.readFile(target, "utf8");
  const oldStr = input.old_string ?? input.oldString ?? "";
  const newStr = input.new_string ?? input.newString ?? "";
  if (!oldStr) {
    return { ok: false, error: "old_string required" };
  }
  if (input.replace_all || input.replaceAll) {
    if (!text.includes(oldStr)) {
      return { ok: false, error: "old_string not found" };
    }
    text = text.split(oldStr).join(newStr);
  } else {
    const idx = text.indexOf(oldStr);
    if (idx < 0) return { ok: false, error: "old_string not found" };
    const second = text.indexOf(oldStr, idx + 1);
    if (second >= 0 && !input.replace_all) {
      return { ok: false, error: "old_string appears multiple times; use replace_all" };
    }
    text = text.slice(0, idx) + newStr + text.slice(idx + oldStr.length);
  }
  await fs5.writeFile(target, text, "utf8");
  return { ok: true, path: target };
}
var FileReadTool = {
  name: "xclaw_file_read",
  description: "Read a UTF-8 text file (optional offset/limit lines).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      offset: { type: "number" },
      limit: { type: "number" }
    },
    required: ["path"]
  },
  isReadOnly: () => true,
  async call(input, context = {}) {
    return { data: await fileRead(input, context) };
  }
};
var FileWriteTool = {
  name: "xclaw_file_write",
  description: "Write text to a file (create/overwrite) within the workspace.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" }
    },
    required: ["path", "content"]
  },
  isReadOnly: () => false,
  async call(input, context = {}) {
    return { data: await fileWrite(input, context) };
  }
};
var FileEditTool = {
  name: "xclaw_file_edit",
  description: "Replace old_string with new_string in a file.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
      replace_all: { type: "boolean" }
    },
    required: ["path", "old_string", "new_string"]
  },
  isReadOnly: () => false,
  async call(input, context = {}) {
    return { data: await fileEdit(input, context) };
  }
};

// src/computer/modules/browser-tab-tool.mjs
import http from "node:http";
import https from "node:https";
import { URL as URL2 } from "node:url";
var tabs = /* @__PURE__ */ new Map();
var seq = 0;
function nextId() {
  seq += 1;
  return `tab_${seq}_${Date.now().toString(36)}`;
}
function fetchUrl(urlStr, timeoutMs = 15e3, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL2(urlStr);
    } catch (e) {
      reject(e);
      return;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      reject(new Error(`Unsupported protocol: ${u.protocol}`));
      return;
    }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      urlStr,
      {
        method: "GET",
        headers: {
          "user-agent": "XClawNativeBrowser/3.75 (+https://github.com/Matrixx0070/xclaw; native-fetch)",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9"
        },
        timeout: timeoutMs
      },
      (res) => {
        const status = res.statusCode || 0;
        if (redirectsLeft > 0 && status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          let next;
          try {
            next = new URL2(res.headers.location, urlStr).href;
          } catch (e) {
            reject(e);
            return;
          }
          fetchUrl(next, timeoutMs, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        let size = 0;
        const max = 2e6;
        res.on("data", (c) => {
          if (size < max) {
            chunks.push(c);
            size += c.length;
          }
        });
        res.on("end", () => {
          resolve({
            status,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            finalUrl: urlStr
          });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(Object.assign(new Error("fetch timeout"), { code: "ETIMEDOUT" }));
    });
    req.end();
  });
}
function extractTitle(html) {
  const m = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 200) : "";
}
function extractMetaDescription(html) {
  const m = String(html).match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
  ) || String(html).match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i
  );
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 500) : "";
}
function htmlToText(html) {
  return String(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 12e3);
}
function extractLinks(html, baseUrl, limit = 30) {
  const links = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && links.length < limit) {
    let href = m[1];
    const label = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
    try {
      href = new URL2(href, baseUrl).href;
    } catch {
      continue;
    }
    if (href.startsWith("http://") || href.startsWith("https://")) {
      links.push({ href, label: label || null });
    }
  }
  return links;
}
function listTabs() {
  return [...tabs.values()].map((t) => ({
    tabId: t.id,
    url: t.url,
    title: t.title,
    status: t.status,
    at: t.at
  }));
}
async function runBrowserTab(input = {}) {
  const action = String(input.action || "").toLowerCase();
  if (input.jsCode) {
    return {
      ok: false,
      error: "jsCode requires CDP/BrowserService. Use XCLAW_COMPUTER_ENGINE=bundle or wire browser-service. See docs/BROWSER_UNBUNDLE.md",
      tabId: input.tabId || null,
      engine: "native-fetch"
    };
  }
  if (input.screenshot) {
    return {
      ok: false,
      error: "screenshot requires CDP/BrowserService. Native browser_tab does not capture images. See docs/BROWSER_UNBUNDLE.md",
      tabId: input.tabId || null,
      engine: "native-fetch"
    };
  }
  if (action === "list" || !input.url && !input.tabId && action !== "read") {
    return {
      ok: true,
      action: "list",
      tabs: listTabs(),
      count: tabs.size,
      engine: "native-fetch"
    };
  }
  if (action === "read" || input.tabId && !input.url) {
    const tab2 = tabs.get(input.tabId);
    if (!tab2) {
      return { ok: false, error: `Unknown tabId: ${input.tabId}`, tabId: input.tabId };
    }
    return {
      ok: true,
      action: "read",
      tabId: tab2.id,
      url: tab2.url,
      title: tab2.title,
      description: tab2.description || "",
      status: tab2.status,
      textPreview: tab2.text.slice(0, 4e3),
      links: tab2.links || [],
      engine: "native-fetch"
    };
  }
  if (!input.url) {
    return {
      ok: false,
      error: "url required for navigate (or action=list|read with tabId)",
      engine: "native-fetch"
    };
  }
  const res = await fetchUrl(input.url);
  const title = extractTitle(res.body);
  const description = extractMetaDescription(res.body);
  const text = htmlToText(res.body);
  const links = extractLinks(res.body, res.finalUrl || input.url);
  const id = input.tabId && tabs.has(input.tabId) ? input.tabId : nextId();
  const tab = {
    id,
    url: res.finalUrl || input.url,
    title,
    description,
    text,
    links,
    status: res.status,
    at: (/* @__PURE__ */ new Date()).toISOString()
  };
  tabs.set(id, tab);
  return {
    ok: true,
    action: "navigate",
    tabId: id,
    url: tab.url,
    title: tab.title,
    description: tab.description,
    status: tab.status,
    textPreview: tab.text.slice(0, 4e3),
    links: links.slice(0, 20),
    engine: "native-fetch",
    networkSummaries: input.includeNetwork ? [
      {
        requestId: "nav1",
        method: "GET",
        url: tab.url,
        status: tab.status
      }
    ] : void 0
  };
}
var BrowserTabTool = {
  name: "xclaw_browser_tab",
  description: "Lightweight native browser: navigate/fetch URL, list/read tabs, extract title/text/links. jsCode and screenshot require CDP bundle (see docs/BROWSER_UNBUNDLE.md).",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "navigate | list | read (default: navigate if url set)"
      },
      url: { type: "string" },
      tabId: { type: "string" },
      jsCode: { type: "string" },
      screenshot: { type: "string" },
      includeNetwork: { type: "boolean" }
    }
  },
  isReadOnly: () => true,
  async call(input, _context = {}) {
    const data = await runBrowserTab(input || {});
    return { data };
  }
};

// src/computer/modules/registry.mjs
var MAINTAINED_TOOLS = [
  BashTool,
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  BrowserTabTool
];
function listMaintainedTools() {
  return MAINTAINED_TOOLS.map((t) => ({
    name: t.name,
    description: typeof t.description === "function" ? t.description() : t.description,
    parameters: t.inputSchema || { type: "object", properties: {} },
    source: "maintained-module"
  }));
}
async function executeMaintainedTool(name, args = {}, ctx = {}) {
  const n = String(name || "");
  const tool = MAINTAINED_TOOLS.find(
    (t) => t.name === n || t.name === `xclaw_${n}` || n === t.name.replace(/^xclaw_/, "")
  );
  if (!tool) {
    return { ok: false, error: `Unknown maintained tool: ${name}`, code: "UNKNOWN_TOOL" };
  }
  const out = await tool.call(args, ctx);
  return out?.data ?? out;
}

// src/computer/native-tools.mjs
var NATIVE_TOOLS = MAINTAINED_TOOLS;
function listNativeTools() {
  return listMaintainedTools().map((t) => ({
    ...t,
    source: "native-clean"
  }));
}
async function executeNativeTool(name, args = {}, ctx = {}) {
  return executeMaintainedTool(name, args, ctx);
}

// src/computer/extraction-status.mjs
import fs6 from "node:fs/promises";
import path5 from "node:path";
import { fileURLToPath } from "node:url";
var root = path5.resolve(path5.dirname(fileURLToPath(import.meta.url)), "../..");
async function loadModuleMap() {
  const p = path5.join(root, "src/computer/MODULE_MAP.json");
  const raw = await fs6.readFile(p, "utf8");
  return JSON.parse(raw);
}
async function getExtractionStatus() {
  const map = await loadModuleMap();
  const native = listNativeTools();
  const extracted = map.extracted || [];
  const cleanIds = /* @__PURE__ */ new Set([
    "bash-tool",
    "file-read-tool",
    "file-write-tool",
    "file-edit-tool"
  ]);
  const nativeReady = native.map((t) => t.name);
  const referenceOnly = extracted.filter((e) => {
    if (e.id === "bash-tool" || e.id.startsWith("file-")) return false;
    return true;
  });
  return {
    ok: true,
    bundle: {
      path: map.sourceBundle,
      bytes: map.sourceBytes,
      lines: map.sourceLines,
      vendoredLines: map.coverage?.vendoredLines,
      appLines: map.coverage?.appLines
    },
    extractedReferenceModules: extracted.map((e) => ({
      id: e.id,
      path: e.path,
      bytes: e.bytes
    })),
    cleanNativeTools: nativeReady,
    cleanModules: map.cleanModules || {},
    progress: {
      // Rough: vendored stays; app surface partially extracted
      appLinesMapped: map.coverage?.appLines ?? null,
      referenceExtractions: extracted.length,
      cleanStandaloneTools: nativeReady.length,
      note: "Vendored ~380k lines remain in bundle. Clean standalone: bash + file read/write/edit. Next: wire native tools into computer HTTP or agent local path; extract browser_tab to clean module."
    },
    nextSlices: [
      "browser-tab-tool \u2192 clean CDP module (prefer browser-service.mjs)",
      "http-server-main \u2192 thin router importing native tools",
      "CI gate: fail if new tool only added inside xclaw-server.mjs"
    ]
  };
}

// src/computer/thin-server.mjs
var ALL = [...NATIVE_TOOLS];
var sessions = /* @__PURE__ */ new Map();
function toolDescriptors() {
  const seen = /* @__PURE__ */ new Set();
  const tools = [];
  for (const t of listNativeTools()) {
    if (!t?.name || seen.has(t.name)) continue;
    seen.add(t.name);
    const desc = typeof t.description === "function" ? t.description() : t.description;
    tools.push({
      name: t.name,
      description: desc || t.name,
      inputSchema: t.parameters || t.inputSchema || { type: "object", properties: {} }
    });
  }
  return tools;
}
async function dispatch(name, args, ctx) {
  if (name === "xclaw_browser_tab" || name === "browser_tab") {
    return runBrowserTab(args || {});
  }
  return executeNativeTool(name, args || {}, ctx);
}
function formatCallResult(name, result) {
  const text = result == null ? "(no result)" : typeof result === "string" ? result : JSON.stringify(result, null, 2);
  const isError = result && result.ok === false;
  return {
    content: [{ type: "text", text }],
    isError: Boolean(isError),
    metadata: { name, engine: "thin-native" }
  };
}
async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}
function createThinComputerServer(opts = {}) {
  const host = opts.host || process.env.XCLAW_COMPUTER_HOST || "127.0.0.1";
  const port = Number(opts.port || process.env.XCLAW_COMPUTER_PORT || 4243);
  const server = http2.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    const send = (code, body) => {
      const raw = typeof body === "string" ? body : JSON.stringify(body);
      res.writeHead(code, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(raw)
      });
      res.end(raw);
    };
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return send(200, {
          status: "healthy",
          ok: true,
          engine: "thin-native",
          sessions: sessions.size,
          tools: toolDescriptors().map((t) => t.name)
        });
      }
      if (req.method === "GET" && url.pathname === "/tools") {
        return send(200, { tools: toolDescriptors() });
      }
      if (req.method === "GET" && url.pathname === "/extraction") {
        return send(200, await getExtractionStatus());
      }
      if (req.method === "POST" && url.pathname === "/xclaw/sessions/create") {
        const parsed = await readJson(req);
        const id = `sess_${crypto3.randomBytes(8).toString("hex")}`;
        const workingDir = parsed.workingDir || process.cwd();
        sessions.set(id, {
          id,
          workingDir,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        return send(200, { sessionId: id, workingDir, engine: "thin-native" });
      }
      if (req.method === "POST" && url.pathname === "/xclaw/sessions/destroy") {
        const parsed = await readJson(req);
        const id = parsed.sessionId;
        if (id) sessions.delete(id);
        return send(200, { ok: true });
      }
      const listMatch = url.pathname.match(
        /^\/xclaw\/sessions\/([^/]+)\/tools\/list$/
      );
      if (req.method === "POST" && listMatch) {
        const id = listMatch[1];
        if (!sessions.has(id)) {
          sessions.set(id, {
            id,
            workingDir: process.cwd(),
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
        return send(200, { tools: toolDescriptors() });
      }
      const callMatch = url.pathname.match(
        /^\/xclaw\/sessions\/([^/]+)\/tools\/call$/
      );
      if (req.method === "POST" && callMatch) {
        const id = callMatch[1];
        const sess = sessions.get(id) || {
          id,
          workingDir: process.cwd()
        };
        if (!sessions.has(id)) sessions.set(id, { ...sess, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
        const parsed = await readJson(req);
        const name = parsed.params?.name || parsed.name || parsed.tool;
        const args = parsed.params?.arguments || parsed.arguments || parsed.args || {};
        if (!name) return send(400, { error: "tool name required" });
        try {
          const result = await dispatch(name, args, {
            cwd: sess.workingDir
          });
          return send(200, formatCallResult(name, result));
        } catch (err) {
          return send(200, {
            content: [{ type: "text", text: String(err.message || err) }],
            isError: true
          });
        }
      }
      if (req.method === "POST" && (url.pathname === "/call" || url.pathname === "/tool")) {
        const parsed = await readJson(req);
        const name = parsed.name || parsed.tool;
        const args = parsed.arguments || parsed.args || parsed.input || {};
        const cwd = parsed.cwd || parsed.workingDir;
        if (!name) return send(400, { error: "name required" });
        const result = await dispatch(name, args, { cwd });
        return send(200, { ok: true, name, result });
      }
      return send(404, {
        error: "not found",
        paths: [
          "/health",
          "/tools",
          "/call",
          "/extraction",
          "/xclaw/sessions/create",
          "/xclaw/sessions/:id/tools/list",
          "/xclaw/sessions/:id/tools/call"
        ]
      });
    } catch (err) {
      return send(500, { error: String(err.message || err) });
    }
  });
  return {
    server,
    host,
    port,
    sessions,
    listen() {
      return new Promise((resolve, reject) => {
        server.listen(port, host, () => {
          console.error(
            `[xclaw-thin] computer listening http://${host}:${port} (native tools, session API)`
          );
          resolve({ host, port });
        });
        server.on("error", reject);
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
}
var isMain = (() => {
  const a = process.argv[1] || "";
  return a.endsWith("thin-server.mjs") || a.includes("thin-server") || a.endsWith("computer-server.mjs") || a.includes("generated/computer-server");
})();
if (isMain) {
  const svc = createThinComputerServer();
  await svc.listen();
}
var thin_server_default = createThinComputerServer;
export {
  createThinComputerServer,
  thin_server_default as default
};
