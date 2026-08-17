/* Strategy C3 GENERATED — do not hand-edit. Full CDP remains xclaw-server.mjs */

// src/computer/thin-server.mjs
import http3 from "node:http";
import crypto4 from "node:crypto";

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
var MAX_TIMEOUT_SECONDS = 120;
function normalizeBashTimeoutSeconds(raw) {
  if (raw == null || raw === "") return DEFAULT_TIMEOUT_SECONDS;
  let n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_TIMEOUT_SECONDS;
  if (n > 1e3) n = n / 1e3;
  if (n > MAX_TIMEOUT_SECONDS) n = MAX_TIMEOUT_SECONDS;
  return n;
}
async function executeBash(input = {}, ctx = {}) {
  let command = String(input.command || "");
  if (!command.trim()) {
    return {
      ok: false,
      stdout: "",
      stderr: "command is required",
      exitCode: 1,
      code: "BASH_EMPTY_COMMAND"
    };
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
      reason: check.reason || "spawn_enforce",
      code: "BASH_SPAWN_DENIED"
    };
  }
  command = check.command || command;
  const timeoutSec = normalizeBashTimeoutSeconds(input.timeout);
  const timeoutMs = Math.min(MAX_TIMEOUT_SECONDS * 1e3, Math.max(0, Math.round(timeoutSec * 1e3)));
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
      reason: wrapped.reason || "os_sandbox",
      code: "BASH_SANDBOX_DENIED"
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
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const max = 2e6;
    child.stdout.on("data", (c) => {
      if (stdout.length >= max) {
        stdoutTruncated = true;
        return;
      }
      const s = c.toString();
      if (stdout.length + s.length > max) {
        stdout += s.slice(0, max - stdout.length);
        stdoutTruncated = true;
      } else {
        stdout += s;
      }
    });
    child.stderr.on("data", (c) => {
      if (stderr.length >= max) {
        stderrTruncated = true;
        return;
      }
      const s = c.toString();
      if (stderr.length + s.length > max) {
        stderr += s.slice(0, max - stderr.length);
        stderrTruncated = true;
      } else {
        stderr += s;
      }
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
      const exitCode = code ?? 1;
      const ok = !timedOut && !interrupted && exitCode === 0;
      const outputTruncated = stdoutTruncated || stderrTruncated;
      if (outputTruncated) {
        const note = `
[xclaw] BASH_OUTPUT_TRUNCATED: kept first ${max} chars` + (stdoutTruncated ? " (stdout)" : "") + (stderrTruncated ? " (stderr)" : "");
        if (stderr.length + note.length <= max + 200) stderr += note;
      }
      let errCode;
      if (timedOut) errCode = "BASH_TIMEOUT";
      else if (interrupted) errCode = "BASH_ABORTED";
      else if (exitCode !== 0) errCode = "BASH_EXIT_NONZERO";
      else if (outputTruncated) errCode = "BASH_OUTPUT_TRUNCATED";
      else errCode = "BASH_OK";
      resolve({
        ok,
        stdout,
        stderr,
        exitCode,
        timedOut,
        interrupted,
        outputTruncated,
        truncated: { stdout: stdoutTruncated, stderr: stderrTruncated, maxChars: max },
        spawnEnforced: Boolean(check.enforced),
        osSandboxed,
        netIsolated: Boolean(wrapped.netIsolated),
        envPolicy: envPolicy.mode,
        code: errCode
      });
    });
  });
}
var BashTool = {
  name: "xclaw_bash",
  description: "Run a bash command in a fresh non-login shell at the session cwd. timeout is SECONDS (default 30, max 120) \u2014 never milliseconds. Prefer short commands; for long jobs use background=true and read the logFile.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Bash command to run" },
      timeout: {
        type: "number",
        description: "Timeout in SECONDS only (1\u2013120). Default 30. Do NOT pass 30000 or other millisecond values.",
        minimum: 0,
        maximum: 120
      },
      background: { type: "boolean" },
      systemRunPlan: {
        type: "object",
        description: "Frozen run plan injected by the gateway approval path for spawn-time enforcement (not model-supplied)"
      }
    },
    required: ["command"]
  },
  execute: executeBash,
  call: async (args, ctx) => {
    const a = { ...args || {} };
    if ("timeout" in a) a.timeout = normalizeBashTimeoutSeconds(a.timeout);
    return executeBash(a, ctx);
  }
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

// src/security/ssrf.mjs
import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
var DEFAULT_MAX_REDIRECTS = 5;
function getSsrfPolicy(cfg = {}) {
  const s = cfg?.security?.ssrf || {};
  const env = String(process.env.XCLAW_SSRF || "").toLowerCase();
  let mode = env || String(s.mode || "").toLowerCase() || "block";
  if (!["block", "off"].includes(mode)) mode = "block";
  return {
    mode,
    allowPrivate: s.allowPrivate === true,
    allowHosts: (s.allowHosts || []).map((h) => String(h).toLowerCase()),
    maxRedirects: Number.isFinite(s.maxRedirects) ? s.maxRedirects : DEFAULT_MAX_REDIRECTS
  };
}
function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = n * 256 + o;
  }
  return n >>> 0;
}
var METADATA_HOSTS = ["metadata.google.internal", "metadata.goog"];
function isMetadataIp(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) {
    const n = ipv4ToInt(ip);
    if (n == null) return true;
    const inRange = (a, bits) => n >>> 32 - bits === ipv4ToInt(a) >>> 32 - bits;
    return inRange("169.254.0.0", 16) || ip === "100.100.100.200";
  }
  if (fam === 6) {
    let v = ip.toLowerCase();
    if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
    if (v === "fd00:ec2::254") return true;
    const m = v.match(/(?:::ffff:|::)((?:\d{1,3}\.){3}\d{1,3})$/i);
    if (m) return isMetadataIp(m[1]);
    return false;
  }
  return true;
}
function isPrivateIp(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) {
    const n = ipv4ToInt(ip);
    if (n == null) return true;
    const inRange = (a, bits) => n >>> 32 - bits === ipv4ToInt(a) >>> 32 - bits;
    return inRange("0.0.0.0", 8) || // "this host"
    inRange("10.0.0.0", 8) || inRange("100.64.0.0", 10) || // CGNAT
    inRange("127.0.0.0", 8) || // loopback
    inRange("169.254.0.0", 16) || // link-local + cloud metadata
    inRange("172.16.0.0", 12) || inRange("192.0.0.0", 24) || inRange("192.168.0.0", 16) || inRange("198.18.0.0", 15) || // benchmarking
    n >= ipv4ToInt("224.0.0.0") >>> 0;
  }
  if (fam === 6) {
    let v = ip.toLowerCase();
    if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true;
    const m = v.match(/(?:::ffff:|::)((?:\d{1,3}\.){3}\d{1,3})$/i);
    if (m) return isPrivateIp(m[1]);
    if (v.startsWith("2002:")) return true;
    return false;
  }
  return true;
}
async function assertUrlAllowed(rawUrl, cfg = {}, opts = {}) {
  const floor = opts.metadataFloor === true;
  const policy = getSsrfPolicy(cfg);
  if (policy.mode === "off" && !floor) return { ok: true, addresses: [], pinIp: null };
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, error: `invalid URL: ${rawUrl}` };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: `blocked scheme ${u.protocol} (http/https only)` };
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (floor && METADATA_HOSTS.includes(host)) {
    return { ok: false, error: `blocked cloud-metadata host ${host}` };
  }
  const bypass = policy.mode === "off" || policy.allowHosts.includes(host) || policy.allowPrivate;
  if (bypass && !floor) return { ok: true, addresses: [], pinIp: null };
  if (net.isIP(host)) {
    if (floor && isMetadataIp(host)) {
      return { ok: false, error: `blocked cloud-metadata address ${host}` };
    }
    if (!bypass && isPrivateIp(host)) {
      return { ok: false, error: `blocked private/loopback address ${host}` };
    }
    return { ok: true, addresses: [host], pinIp: bypass ? null : host };
  }
  let addrs;
  try {
    const results = await dns.lookup(host, { all: true, verbatim: true });
    addrs = results.map((r) => r.address);
  } catch (err) {
    return { ok: false, error: `DNS resolution failed for ${host}: ${err.message}` };
  }
  if (!addrs.length) return { ok: false, error: `no addresses for ${host}` };
  for (const a of addrs) {
    if (floor && isMetadataIp(a)) {
      return { ok: false, error: `${host} resolves to cloud-metadata ${a} \u2014 blocked` };
    }
    if (!bypass && isPrivateIp(a)) {
      return { ok: false, error: `${host} resolves to private/loopback ${a} \u2014 blocked` };
    }
  }
  return { ok: true, addresses: addrs, pinIp: bypass ? null : addrs[0] };
}
function toResponseLike(res, finalUrl, bodyBuf) {
  const h = /* @__PURE__ */ new Map();
  for (const [k, v] of Object.entries(res.headers)) {
    h.set(k.toLowerCase(), Array.isArray(v) ? v.join(", ") : v);
  }
  return {
    status: res.statusCode,
    ok: res.statusCode >= 200 && res.statusCode < 300,
    url: finalUrl,
    headers: { get: (k) => h.get(String(k).toLowerCase()) ?? null },
    async text() {
      return decodeBody(res.headers["content-encoding"], bodyBuf).toString("utf8");
    },
    async json() {
      return JSON.parse(decodeBody(res.headers["content-encoding"], bodyBuf).toString("utf8"));
    },
    async arrayBuffer() {
      const b = decodeBody(res.headers["content-encoding"], bodyBuf);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    }
  };
}
function decodeBody(encoding, buf) {
  const enc = String(encoding || "").toLowerCase();
  try {
    if (enc === "gzip") return zlib.gunzipSync(buf);
    if (enc === "deflate") return zlib.inflateSync(buf);
    if (enc === "br") return zlib.brotliDecompressSync(buf);
  } catch {
  }
  return buf;
}
function requestPinned(rawUrl, { method = "GET", headers = {}, signal, ip, timeoutMs = 25e3, maxBytes = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(rawUrl);
    } catch (err) {
      return reject(err);
    }
    if (signal?.aborted) return reject(new Error("aborted"));
    const mod = u.protocol === "https:" ? https : http;
    const family = ip ? net.isIP(ip) : 0;
    const lookup = ip ? (hostname, opts, cb) => {
      const callback = typeof opts === "function" ? opts : cb;
      if (opts && typeof opts === "object" && opts.all) {
        return callback(null, [{ address: ip, family }]);
      }
      callback(null, ip, family);
    } : void 0;
    const reqHeaders = { "Accept-Encoding": "identity", ...headers };
    const req = mod.request(
      u,
      { method, headers: reqHeaders, lookup, servername: u.hostname },
      (res) => {
        const chunks = [];
        let size = 0;
        let truncated = false;
        const finish = () => resolve(toResponseLike(res, u.toString(), Buffer.concat(chunks)));
        res.on("data", (c) => {
          chunks.push(c);
          size += c.length;
          if (maxBytes > 0 && size >= maxBytes && !truncated) {
            truncated = true;
            res.destroy();
          }
        });
        res.on("end", finish);
        res.on("close", () => {
          if (truncated) finish();
        });
        res.on("error", (err) => {
          if (truncated) return finish();
          reject(err);
        });
      }
    );
    const onAbort = () => {
      req.destroy(new Error("aborted"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
    req.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(err);
    });
    req.end();
  });
}
async function safeFetch(rawUrl, init = {}, cfg = {}, opts = {}) {
  const policy = getSsrfPolicy(cfg);
  const floor = opts.metadataFloor === true;
  if (policy.mode === "off" && !floor) return fetch(rawUrl, init);
  let current = rawUrl;
  for (let hop = 0; hop <= policy.maxRedirects; hop++) {
    const check = await assertUrlAllowed(current, cfg, opts);
    if (!check.ok) {
      const e2 = new Error(`SSRF blocked: ${check.error}`);
      e2.code = "SSRF_BLOCKED";
      throw e2;
    }
    const res = await requestPinned(current, {
      method: init.method || "GET",
      headers: init.headers || {},
      signal: init.signal,
      ip: check.pinIp,
      ...init.timeoutMs ? { timeoutMs: init.timeoutMs } : {},
      ...init.maxBytes ? { maxBytes: init.maxBytes } : {}
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  const e = new Error(`SSRF blocked: too many redirects (>${policy.maxRedirects})`);
  e.code = "SSRF_BLOCKED";
  throw e;
}

// src/browser/cdp-client.mjs
import http2 from "node:http";
import crypto3 from "node:crypto";
var LOOPBACK = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
function httpGetJson(host, port, path8, timeoutMs = 4e3) {
  return new Promise((resolve, reject) => {
    const req = http2.get({ host, port, path: path8, timeout: timeoutMs }, (r) => {
      let d = "";
      r.on("data", (c) => d += c);
      r.on("end", () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(new Error(`CDP ${path8}: invalid JSON (${e.message})`));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("CDP HTTP timeout")));
    req.on("error", reject);
  });
}
function wsConnect(wsUrl, opts = {}) {
  const {
    timeoutMs = 8e3,
    keepAlive = true,
    keepAliveInitialDelayMs = 3e4,
    heartbeatIntervalMs = 0,
    heartbeatTimeoutMs = 5e3,
    onDisconnect = null
  } = opts;
  const u = new URL(wsUrl);
  const key = crypto3.randomBytes(16).toString("base64");
  return new Promise((resolve, reject) => {
    const req = http2.request({
      host: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      timeout: timeoutMs,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": key,
        "Sec-WebSocket-Version": "13"
      }
    });
    req.on("timeout", () => req.destroy(new Error("CDP WS timeout")));
    req.on("upgrade", (res, socket) => {
      socket.setNoDelay(true);
      if (keepAlive !== false) {
        try {
          socket.setKeepAlive(true, Math.max(0, Number(keepAliveInitialDelayMs) || 3e4));
        } catch {
        }
      }
      const pending = /* @__PURE__ */ new Map();
      let id = 0;
      let buf = Buffer.alloc(0);
      let closed = false;
      let heartbeatTimer = null;
      let onPong = null;
      function failPending(err) {
        const e = err instanceof Error ? err : new Error(String(err || "CDP socket closed"));
        for (const { reject: rej2 } of pending.values()) {
          try {
            rej2(e);
          } catch {
          }
        }
        pending.clear();
      }
      function markClosed(err) {
        if (closed) return;
        closed = true;
        stopHeartbeat();
        failPending(err || new Error("CDP socket closed"));
        try {
          onDisconnect?.(err instanceof Error ? err : err ? new Error(String(err)) : void 0);
        } catch {
        }
      }
      function writeFrame(opcode, payload = Buffer.alloc(0)) {
        if (closed || socket.destroyed) {
          throw new Error("CDP socket closed");
        }
        const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
        const mask = crypto3.randomBytes(4);
        const masked = Buffer.from(data);
        for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
        let header;
        const b0 = 128 | opcode & 15;
        if (data.length < 126) {
          header = Buffer.from([b0, 128 | data.length]);
        } else if (data.length < 65536) {
          header = Buffer.alloc(4);
          header[0] = b0;
          header[1] = 128 | 126;
          header.writeUInt16BE(data.length, 2);
        } else {
          header = Buffer.alloc(10);
          header[0] = b0;
          header[1] = 128 | 127;
          header.writeBigUInt64BE(BigInt(data.length), 2);
        }
        socket.write(Buffer.concat([header, mask, masked]));
      }
      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        for (; ; ) {
          if (buf.length < 2) return;
          const fin = (buf[0] & 128) !== 0;
          const op = buf[0] & 15;
          let len = buf[1] & 127;
          let off = 2;
          const masked = (buf[1] & 128) !== 0;
          if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            off = 4;
          } else if (len === 127) {
            if (buf.length < 10) return;
            len = Number(buf.readBigUInt64BE(2));
            off = 10;
          }
          const maskLen = masked ? 4 : 0;
          if (buf.length < off + maskLen + len) return;
          let payload = buf.slice(off + maskLen, off + maskLen + len);
          if (masked) {
            const mkey = buf.slice(off, off + 4);
            payload = Buffer.from(payload);
            for (let i = 0; i < payload.length; i++) payload[i] ^= mkey[i % 4];
          }
          buf = buf.slice(off + maskLen + len);
          if (op === 8) {
            try {
              if (!closed) writeFrame(8, payload.length ? payload : Buffer.alloc(0));
            } catch {
            }
            markClosed(new Error("CDP peer closed WebSocket"));
            socket.destroy();
            return;
          }
          if (op === 9) {
            try {
              writeFrame(10, payload);
            } catch {
            }
            continue;
          }
          if (op === 10) {
            try {
              onPong?.(payload);
            } catch {
            }
            continue;
          }
          if (op === 1 && fin) {
            try {
              const msg = JSON.parse(payload.toString("utf8"));
              if (msg.id && pending.has(msg.id)) {
                const { resolve: res2, reject: rej2 } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) rej2(new Error(msg.error.message || "CDP error"));
                else res2(msg.result);
              }
            } catch {
            }
          }
        }
      });
      socket.on("error", (err) => {
        markClosed(err || new Error("CDP socket error"));
      });
      socket.on("close", () => {
        markClosed(new Error("CDP socket closed"));
      });
      socket.on("end", () => {
        markClosed(new Error("CDP socket ended"));
      });
      function send(method, params = {}, { timeoutMs: t = 15e3 } = {}) {
        if (closed) return Promise.reject(new Error("CDP socket closed"));
        const mid = ++id;
        const data = Buffer.from(JSON.stringify({ id: mid, method, params }));
        try {
          writeFrame(1, data);
        } catch (e) {
          return Promise.reject(e);
        }
        return new Promise((res2, rej2) => {
          pending.set(mid, { resolve: res2, reject: rej2 });
          setTimeout(() => {
            if (pending.has(mid)) {
              pending.delete(mid);
              rej2(new Error(`CDP ${method} timed out`));
            }
          }, t).unref?.();
        });
      }
      function ping(payload = Buffer.alloc(0), opts2 = {}) {
        if (closed) return Promise.reject(new Error("CDP socket closed"));
        const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || ""), "utf8");
        const body = data.length > 125 ? data.subarray(0, 125) : data;
        try {
          writeFrame(9, body);
        } catch (e) {
          return Promise.reject(e);
        }
        if (!opts2.wait) return Promise.resolve();
        const waitMs = Number(opts2.timeoutMs) > 0 ? Number(opts2.timeoutMs) : 5e3;
        return new Promise((res2, rej2) => {
          const prev = onPong;
          const timer = setTimeout(() => {
            onPong = prev;
            rej2(new Error("CDP WebSocket ping timed out"));
          }, waitMs);
          timer.unref?.();
          onPong = (pongPayload) => {
            onPong = prev;
            clearTimeout(timer);
            res2(pongPayload);
            try {
              prev?.(pongPayload);
            } catch {
            }
          };
        });
      }
      function stopHeartbeat() {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      }
      function startHeartbeat(hbOpts = {}) {
        stopHeartbeat();
        const interval = Number(hbOpts.intervalMs) > 0 ? Number(hbOpts.intervalMs) : Number(heartbeatIntervalMs) > 0 ? Number(heartbeatIntervalMs) : 3e4;
        const waitMs = Number(hbOpts.timeoutMs) > 0 ? Number(hbOpts.timeoutMs) : Number(heartbeatTimeoutMs) || 5e3;
        const onMiss = hbOpts.onMiss || ((err) => markClosed(err));
        heartbeatTimer = setInterval(() => {
          if (closed) {
            stopHeartbeat();
            return;
          }
          ping("xclaw-hb", { wait: true, timeoutMs: waitMs }).catch((err) => {
            try {
              onMiss(err instanceof Error ? err : new Error(String(err)));
            } catch {
            }
          });
        }, interval);
        heartbeatTimer.unref?.();
        return () => stopHeartbeat();
      }
      if (Number(heartbeatIntervalMs) > 0) {
        startHeartbeat({
          intervalMs: heartbeatIntervalMs,
          timeoutMs: heartbeatTimeoutMs
        });
      }
      resolve({
        send,
        ping,
        startHeartbeat,
        stopHeartbeat,
        isOpen: () => !closed && !socket.destroyed,
        close: () => {
          stopHeartbeat();
          if (!closed) {
            try {
              writeFrame(8, Buffer.alloc(0));
            } catch {
            }
          }
          markClosed(new Error("CDP socket closed by client"));
          socket.destroy();
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}
function createCdpClient(opts = {}) {
  const host = String(opts.host || "127.0.0.1");
  const port = Number(opts.port || 9222);
  if (!LOOPBACK.has(host) && opts.allowRemote !== true) {
    throw new Error(`CDP host ${host} is not loopback (set allowRemote to override)`);
  }
  const wsOpts = {
    keepAlive: opts.keepAlive !== false,
    keepAliveInitialDelayMs: opts.keepAliveInitialDelayMs ?? 3e4,
    heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 0,
    heartbeatTimeoutMs: opts.heartbeatTimeoutMs ?? 5e3
  };
  return {
    host,
    port,
    /** @returns {Promise<Array<{id,type,url,title,webSocketDebuggerUrl}>>} */
    async listPages() {
      const targets = await httpGetJson(host, port, "/json/list");
      return (Array.isArray(targets) ? targets : []).filter((t) => t.type === "page");
    },
    /** Open a new tab (modern Chrome requires PUT /json/new). */
    async newPage(url) {
      const q = url ? `?${encodeURIComponent(url)}` : "";
      return new Promise((resolve, reject) => {
        const req = http2.request(
          { host, port, path: `/json/new${q}`, method: "PUT", timeout: 5e3 },
          (r) => {
            let d = "";
            r.on("data", (c) => d += c);
            r.on("end", () => {
              try {
                resolve(JSON.parse(d));
              } catch (e) {
                reject(new Error(`CDP /json/new: ${e.message}`));
              }
            });
          }
        );
        req.on("timeout", () => req.destroy(new Error("CDP /json/new timeout")));
        req.on("error", reject);
        req.end();
      });
    },
    /**
     * Attach to a page (by predicate, url substring, or the first page).
     * @returns {Promise<{page, send, ping, evaluate, navigate, screenshot, close}>}
     */
    async attach(match) {
      const pages = await this.listPages();
      let page = null;
      if (typeof match === "function") page = pages.find(match);
      else if (typeof match === "string" && match) page = pages.find((p) => String(p.url || "").includes(match));
      if (!page) page = pages[0];
      if (!page) throw new Error("no CDP page target available");
      const ws = await wsConnect(page.webSocketDebuggerUrl, wsOpts);
      return {
        page,
        /** Raw CDP command access for advanced callers (Input.*, DOM.*, …). */
        send: (method, params, sendOpts) => ws.send(method, params, sendOpts),
        /** WebSocket-level ping (not a CDP domain method). */
        ping: (payload, pingOpts) => ws.ping(payload, pingOpts),
        startHeartbeat: (hbOpts) => ws.startHeartbeat(hbOpts),
        stopHeartbeat: () => ws.stopHeartbeat(),
        isOpen: () => ws.isOpen(),
        async evaluate(expression, { awaitPromise = true, timeoutMs } = {}) {
          const r = await ws.send(
            "Runtime.evaluate",
            { expression, returnByValue: true, awaitPromise },
            timeoutMs ? { timeoutMs } : {}
          );
          if (r?.exceptionDetails) {
            throw new Error(r.exceptionDetails.exception?.description || "evaluate failed");
          }
          return r?.result?.value;
        },
        async navigate(url) {
          await ws.send("Page.enable");
          await ws.send("Page.navigate", { url });
        },
        async screenshot() {
          const r = await ws.send("Page.captureScreenshot", { format: "png" });
          return Buffer.from(r.data, "base64");
        },
        close() {
          ws.close();
        }
      };
    }
  };
}

// src/browser/humanize.mjs
var ENABLED = process.env.XCLAW_BROWSER_HUMANIZE !== "0" && process.env.XCLAW_BROWSER_HUMANIZE !== "false";
var SPEED = Math.max(
  0.25,
  Math.min(3, Number(process.env.XCLAW_BROWSER_HUMANIZE_SPEED) || 1)
);
function gauss(mean = 0, std = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function clampMs(ms, min = 8, max = 8e3) {
  return Math.max(min, Math.min(max, Math.round(ms * SPEED)));
}
function reactionDelay() {
  if (!ENABLED) return 0;
  const ms = Math.exp(gauss(5.5, 0.35));
  return clampMs(ms, 80, 1200);
}
function keyDelay(char = "a") {
  if (!ENABLED) return 0;
  let base = 55 + gauss(0, 18);
  if (char === " " || char === "\n") base += 40 + Math.random() * 80;
  if (/[.,!?;:]/.test(char)) base += 60 + Math.random() * 120;
  if (Math.random() < 0.04) base += 180 + Math.random() * 400;
  return clampMs(base, 25, 900);
}
function settleDelay() {
  if (!ENABLED) return 0;
  return clampMs(90 + gauss(40, 35), 40, 600);
}
function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}
function bezier(t, p0, p1, p2, p3) {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
  };
}
function fittsDuration(distancePx, targetWidthPx = 24, opts = {}) {
  const a = opts.a ?? 70;
  const b = opts.b ?? 120;
  const W = Math.max(4, Number(targetWidthPx) || 24);
  const D = Math.max(1, Number(distancePx) || 1);
  const id = Math.log2(D / W + 1);
  let mt = a + b * id;
  if (ENABLED) mt += gauss(0, mt * 0.12);
  return clampMs(mt, 40, 2500);
}
function readingPause(text = "") {
  if (!ENABLED) return 0;
  const n = String(text || "").length;
  if (n < 8) return clampMs(40 + gauss(20, 15), 0, 200);
  const base = n / 18 * 1e3;
  return clampMs(base * (0.7 + Math.random() * 0.6) + gauss(0, 80), 60, 8e3);
}
function fittsID(distancePx, targetWidthPx = 24) {
  const W = Math.max(4, Number(targetWidthPx) || 24);
  const D = Math.max(1, Number(distancePx) || 1);
  return Math.log2(D / W + 1);
}
function mousePath(x0, y0, x1, y1, opts = {}) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  if (dist < 2 || !ENABLED) {
    return [{ x: x1, y: y1, delayMs: 0 }];
  }
  const steps = Math.max(
    8,
    Math.min(48, Math.round(dist / (opts.stepPx || 12)))
  );
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const curve = (0.15 + Math.random() * 0.35) * dist * (Math.random() < 0.5 ? 1 : -1);
  const overshoot = Math.random() < 0.25 ? 0.08 + Math.random() * 0.12 : 0;
  const p0 = { x: x0, y: y0 };
  const p3 = {
    x: x1 + dx * overshoot,
    y: y1 + dy * overshoot
  };
  const p1 = {
    x: x0 + dx * 0.25 + nx * curve * 0.6,
    y: y0 + dy * 0.25 + ny * curve * 0.6
  };
  const p2 = {
    x: x0 + dx * 0.75 + nx * curve * 0.4,
    y: y0 + dy * 0.75 + ny * curve * 0.4
  };
  const targetW = opts.targetWidth ?? opts.width ?? null;
  const totalMs = targetW ? fittsDuration(dist, targetW, opts.fitts || {}) : clampMs(180 + dist * 0.35 + gauss(0, 30), 60, 2200);
  const path8 = [];
  let prevT = 0;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const t = u * u * (3 - 2 * u);
    const pt = bezier(t, p0, p1, p2, p3);
    const tremor = opts.tremor != null ? Number(opts.tremor) : 1.8;
    const jitter = (1 - u) * tremor;
    pt.x += gauss(0, jitter);
    pt.y += gauss(0, jitter);
    const dt = (t - prevT) * totalMs;
    path8.push({
      x: Math.round(pt.x * 10) / 10,
      y: Math.round(pt.y * 10) / 10,
      delayMs: clampMs(dt + gauss(0, 4), 4, 120)
    });
    prevT = t;
  }
  path8.push({ x: x1, y: y1, delayMs: clampMs(12 + Math.random() * 20, 8, 40) });
  return path8;
}
function typingPlan(text) {
  if (!ENABLED) {
    return [...text].map((c) => ({ char: c, delayMs: 0 }));
  }
  return [...text].map((c) => ({ char: c, delayMs: keyDelay(c) }));
}
async function humanType(text, dispatchKey) {
  await sleep(reactionDelay());
  for (const { char, delayMs } of typingPlan(text)) {
    await dispatchKey(char);
    await sleep(delayMs);
  }
  await sleep(settleDelay());
}
async function humanClick(from, to, dispatchMouse, opts = {}) {
  await sleep(reactionDelay());
  if (opts.label) await sleep(readingPause(String(opts.label).slice(0, 120)));
  const path8 = mousePath(from.x, from.y, to.x, to.y, opts);
  for (const step of path8) {
    await dispatchMouse(step.x, step.y, "mouseMoved");
    await sleep(step.delayMs);
  }
  await dispatchMouse(to.x, to.y, "mousePressed");
  await sleep(clampMs(45 + gauss(15, 12), 30, 120));
  await dispatchMouse(to.x, to.y, "mouseReleased");
  await sleep(settleDelay());
}
function scrollPlan(totalDeltaY, opts = {}) {
  if (!ENABLED || Math.abs(totalDeltaY) < 5) {
    return [{ deltaY: totalDeltaY, delayMs: 0 }];
  }
  const steps = Math.max(3, Math.min(18, Math.round(Math.abs(totalDeltaY) / 40)));
  const plan = [];
  let remaining = totalDeltaY;
  for (let i = 0; i < steps; i++) {
    const frac = (steps - i) / (steps * (steps + 1) / 2);
    let d = remaining * (0.35 + Math.random() * 0.4);
    if (i === steps - 1) d = remaining;
    remaining -= d;
    plan.push({
      deltaY: Math.round(d),
      delayMs: clampMs(28 + gauss(12, 10) + i * 4, 12, 90)
    });
  }
  return plan;
}
async function humanScroll(totalDeltaY, dispatchWheel) {
  await sleep(reactionDelay() * 0.6);
  for (const step of scrollPlan(totalDeltaY)) {
    if (step.deltaY !== 0) await dispatchWheel(step.deltaY);
    await sleep(step.delayMs);
  }
  await sleep(settleDelay() * 0.7);
}
var humanize = {
  enabled: ENABLED,
  speed: SPEED,
  reactionDelay,
  keyDelay,
  settleDelay,
  sleep,
  mousePath,
  typingPlan,
  humanType,
  humanClick,
  scrollPlan,
  humanScroll,
  fittsDuration,
  fittsID,
  readingPause
};

// src/browser/motor.mjs
function planClick(opts = {}) {
  const x = Number(opts.x);
  const y = Number(opts.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("motor.planClick requires numeric x,y");
  }
  const fromX = Number.isFinite(Number(opts.fromX)) ? Number(opts.fromX) : x - 40;
  const fromY = Number.isFinite(Number(opts.fromY)) ? Number(opts.fromY) : y - 30;
  const button = opts.button || "left";
  const clickCount = opts.clickCount || 1;
  const targetWidth = opts.targetWidth ?? opts.width ?? 24;
  const steps = [];
  const react = reactionDelay();
  if (react > 0) steps.push({ method: "_sleep", params: {}, delayMs: react });
  if (opts.label) {
    const rp = readingPause(String(opts.label));
    if (rp > 0) steps.push({ method: "_sleep", params: {}, delayMs: rp });
  }
  const path8 = mousePath(fromX, fromY, x, y, {
    targetWidth,
    tremor: opts.tremor
  });
  for (const pt of path8) {
    steps.push({
      method: "Input.dispatchMouseEvent",
      params: {
        type: "mouseMoved",
        x: pt.x,
        y: pt.y,
        button: "none"
      },
      delayMs: pt.delayMs || 0
    });
  }
  for (let c = 1; c <= clickCount; c++) {
    steps.push({
      method: "Input.dispatchMouseEvent",
      params: {
        type: "mousePressed",
        x,
        y,
        button,
        clickCount: c
      },
      delayMs: 20 + Math.round(Math.random() * 25)
    });
    steps.push({
      method: "Input.dispatchMouseEvent",
      params: {
        type: "mouseReleased",
        x,
        y,
        button,
        clickCount: c
      },
      delayMs: 30 + Math.round(Math.random() * 40)
    });
  }
  const settle = settleDelay();
  if (settle > 0) steps.push({ method: "_sleep", params: {}, delayMs: settle });
  return {
    steps,
    meta: {
      kind: "click",
      x,
      y,
      fromX,
      fromY,
      targetWidth,
      fittsMs: fittsDuration(Math.hypot(x - fromX, y - fromY), targetWidth),
      humanize: humanize.enabled,
      stepCount: steps.length
    }
  };
}
function planType(opts = {}) {
  const text = String(opts.text ?? "");
  const steps = [];
  const react = reactionDelay();
  if (react > 0) steps.push({ method: "_sleep", params: {}, delayMs: react });
  for (const ch of text) {
    const delay = keyDelay(ch);
    steps.push({
      method: "Input.dispatchKeyEvent",
      params: {
        type: "keyDown",
        text: ch,
        unmodifiedText: ch,
        key: ch
      },
      delayMs: Math.max(8, Math.floor(delay * 0.4))
    });
    steps.push({
      method: "Input.dispatchKeyEvent",
      params: {
        type: "char",
        text: ch,
        unmodifiedText: ch
      },
      delayMs: Math.max(4, Math.floor(delay * 0.2))
    });
    steps.push({
      method: "Input.dispatchKeyEvent",
      params: {
        type: "keyUp",
        text: ch,
        unmodifiedText: ch,
        key: ch
      },
      delayMs: Math.max(8, Math.floor(delay * 0.4))
    });
  }
  const settle = settleDelay();
  if (settle > 0) steps.push({ method: "_sleep", params: {}, delayMs: settle });
  return {
    steps,
    meta: {
      kind: "type",
      length: text.length,
      humanize: humanize.enabled,
      stepCount: steps.length
    }
  };
}
function planScroll(opts = {}) {
  const x = Number(opts.x) || 0;
  const y = Number(opts.y) || 0;
  const deltaY = Number(opts.deltaY) || 300;
  const deltaX = Number(opts.deltaX) || 0;
  const steps = [];
  const react = reactionDelay();
  if (react > 0) steps.push({ method: "_sleep", params: {}, delayMs: react });
  const chunks = Math.max(1, Math.min(12, Math.round(Math.abs(deltaY) / 80)));
  const tick = deltaY / chunks;
  for (let i = 0; i < chunks; i++) {
    steps.push({
      method: "Input.dispatchMouseEvent",
      params: {
        type: "mouseWheel",
        x,
        y,
        deltaX: deltaX / chunks,
        deltaY: tick
      },
      delayMs: 40 + Math.round(Math.random() * 50)
    });
  }
  const settle = settleDelay();
  if (settle > 0) steps.push({ method: "_sleep", params: {}, delayMs: settle });
  return {
    steps,
    meta: { kind: "scroll", deltaY, chunks, humanize: humanize.enabled }
  };
}
async function executeSteps(tabClient, steps, opts = {}) {
  const sleepFn = opts.sleep || sleep;
  const log = opts.log || (() => {
  });
  let executed = 0;
  for (const step of steps) {
    if (step.method === "_sleep") {
      await sleepFn(step.delayMs || 0);
      executed++;
      continue;
    }
    try {
      if (typeof tabClient.send === "function") {
        await tabClient.send(step.method, step.params);
      } else {
        const [domain, method] = step.method.split(".");
        const target = tabClient[domain];
        if (target && typeof target[method] === "function") {
          await target[method](step.params);
        } else if (typeof tabClient[step.method] === "function") {
          await tabClient[step.method](step.params);
        } else {
          throw new Error(`no dispatcher for ${step.method}`);
        }
      }
    } catch (e) {
      log(`motor step failed ${step.method}: ${e?.message || e}`);
      throw e;
    }
    if (step.delayMs) await sleepFn(step.delayMs);
    executed++;
  }
  return { executed, total: steps.length };
}

// src/computer/cua-errors.mjs
var CUA_ERROR_CATALOG = {
  // computer_act / CDP
  USE_BROWSER_OBSERVE: {
    severity: "info",
    surface: "browser",
    recovery: "Call xclaw_browser_tab with action=observe for structure. computer_act is for GUI actuation only."
  },
  CUA_ACT_REQUIRES_BUNDLE: {
    severity: "error",
    surface: "cdp",
    recovery: "Set XCLAW_CDP_URL to a Chrome remote-debugging endpoint (e.g. http://127.0.0.1:9222). Prefer tools/APIs first."
  },
  CUA_ACT_NOT_EXTRACTED: {
    severity: "error",
    surface: "bundle",
    recovery: "engine=bundle without CDP: attach XCLAW_CDP_URL for CLEAN motor path, or extract BrowserService modules."
  },
  CDP_ATTACH_FAILED: {
    severity: "error",
    surface: "cdp",
    recovery: "CDP URL set but attach failed. Ensure Chrome is running with --remote-debugging-port and the port matches. Try: curl $XCLAW_CDP_URL/json/version"
  },
  CDP_NO_PAGE: {
    severity: "error",
    surface: "cdp",
    recovery: "No page target under CDP. Open a tab in the debugged Chrome or use action=navigate / client.newPage."
  },
  CDP_NOT_LOOPBACK: {
    severity: "error",
    surface: "cdp",
    recovery: "CDP host is not loopback. Use 127.0.0.1 or set allowRemote only in trusted networks."
  },
  CDP_SOCKET_CLOSED: {
    severity: "error",
    surface: "cdp",
    recovery: "CDP WebSocket closed mid-command. Chrome may have exited; restart debug browser and retry."
  },
  CDP_TIMEOUT: {
    severity: "error",
    surface: "cdp",
    recovery: "CDP HTTP/WS timeout. Check Chrome is responsive; increase load; retry with XCLAW_CUA_RETRIES."
  },
  CDP_HTTP_FAILED: {
    severity: "error",
    surface: "cdp",
    recovery: "CDP HTTP /json/* failed. Verify XCLAW_CDP_URL and curl $XCLAW_CDP_URL/json/version."
  },
  CDP_WS_FAILED: {
    severity: "error",
    surface: "cdp",
    recovery: "CDP WebSocket upgrade/connect failed. Port may be HTTP-only or blocked; confirm webSocketDebuggerUrl."
  },
  CDP_EVAL_FAILED: {
    severity: "error",
    surface: "cdp",
    recovery: "Runtime.evaluate threw in page. Re-observe DOM; selector/ref may be stale."
  },
  CDP_NAVIGATE_FAILED: {
    severity: "error",
    surface: "cdp",
    recovery: "Page.navigate failed. Check URL scheme (http/https), network, and that the tab still exists."
  },
  CDP_SCREENSHOT_FAILED: {
    severity: "error",
    surface: "cdp",
    recovery: "Page.captureScreenshot failed. Page may be crashed or target detached; re-attach and retry."
  },
  CDP_INPUT_FAILED: {
    severity: "error",
    surface: "cdp",
    recovery: "Input.dispatch* failed. Page may not be focused or target closed; navigate/observe then retry."
  },
  CUA_ACT_NEED_COORDS: {
    severity: "error",
    surface: "cdp",
    recovery: "Provide x,y or a valid observe ref (eN) with tabId after observe."
  },
  CUA_ACT_NEED_URL: {
    severity: "error",
    surface: "cdp",
    recovery: "Pass url (https://\u2026) for action=navigate."
  },
  CUA_ACT_NEED_KEY: {
    severity: "error",
    surface: "cdp",
    recovery: "Pass key string (e.g. Enter, Tab, Control+s)."
  },
  CUA_ACT_UNKNOWN: {
    severity: "error",
    surface: "cdp",
    recovery: "Supported actions: navigate, click, type, key, scroll, screenshot (observe via browser_tab)."
  },
  CUA_ACT_EXEC_FAILED: {
    severity: "error",
    surface: "cdp",
    recovery: "Motor/CDP command failed mid-execution. Check page still open; retry once; re-observe if DOM changed."
  },
  // Desktop common
  DESKTOP_GUI_DISABLED: {
    severity: "warn",
    surface: "desktop",
    recovery: "Default fail-closed. Lab only: export XCLAW_DESKTOP_GUI=1. Prefer XCLAW_CDP_URL for browser UIs."
  },
  DESKTOP_GUI_UNSUPPORTED_OS: {
    severity: "error",
    surface: "desktop",
    recovery: "This OS path is not available here. Use browser CDP or run on a supported host OS."
  },
  DESKTOP_GUI_NO_BACKEND: {
    severity: "error",
    surface: "desktop",
    recovery: "Install xdotool (Linux) or ydotool (Wayland). Windows/mac use pywinauto/pyobjc helpers."
  },
  DESKTOP_OBSERVE_UNSUPPORTED_OS: {
    severity: "error",
    surface: "desktop",
    recovery: "Observe helper is OS-specific. Use the matching platform helper or browser observe."
  },
  DESKTOP_NEED_COORDS: {
    severity: "error",
    surface: "desktop",
    recovery: "desktop click requires numeric x,y (or invoke with name after observe)."
  },
  DESKTOP_NEED_KEY: {
    severity: "error",
    surface: "desktop",
    recovery: "Pass key (e.g. enter, cmd+s)."
  },
  DESKTOP_NEED_NAME: {
    severity: "error",
    surface: "desktop",
    recovery: "invoke requires name (and optional title/app) matching an accessibility node."
  },
  DESKTOP_NEED_TEXT: {
    severity: "error",
    surface: "desktop",
    recovery: "type requires text string."
  },
  DESKTOP_ACT_UNKNOWN: {
    severity: "error",
    surface: "desktop",
    recovery: "Supported: click, type, key, invoke (platform-dependent)."
  },
  DESKTOP_ACT_FAILED: {
    severity: "error",
    surface: "desktop",
    recovery: "OS input injection failed. Check backend binary, display server, and permissions."
  },
  // AT-SPI
  ATSPI_NOT_INSTALLED: {
    severity: "warn",
    surface: "desktop-linux",
    recovery: "sudo apt install python3-pyatspi   # or gir1.2-atspi-2.0"
  },
  ATSPI_REGISTRY_FAILED: {
    severity: "error",
    surface: "desktop-linux",
    recovery: "AT-SPI registry unavailable. Is a desktop session running? Check accessibility bus."
  },
  ATSPI_WALK_FAILED: {
    severity: "error",
    surface: "desktop-linux",
    recovery: "Tree walk failed. Retry; filter with app=; check app exposes AT-SPI."
  },
  ATSPI_EMPTY: {
    severity: "warn",
    surface: "desktop-linux",
    recovery: "Helper returned empty stdout. Reinstall helper script / python3."
  },
  ATSPI_HELPER_MISSING: {
    severity: "error",
    surface: "desktop-linux",
    recovery: "scripts/desktop-atspi-observe.py or python3 missing from install."
  },
  ATSPI_EXEC_FAILED: {
    severity: "error",
    surface: "desktop-linux",
    recovery: "Failed to exec AT-SPI helper. Check python3 and script permissions."
  },
  ATSPI_BAD_JSON: {
    severity: "error",
    surface: "desktop-linux",
    recovery: "Helper emitted non-JSON. See raw field; fix script version mismatch."
  },
  // UIA
  UIA_NOT_INSTALLED: {
    severity: "warn",
    surface: "desktop-windows",
    recovery: "pip install pywinauto"
  },
  UIA_DESKTOP_FAILED: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "Could not open UIA Desktop(). Run in an interactive Windows session."
  },
  UIA_WALK_FAILED: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "UIA tree walk failed. Try app= filter; run elevated only if target requires it."
  },
  UIA_WINDOW_NOT_FOUND: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "No window matched title=. List windows via observe first."
  },
  UIA_ELEMENT_NOT_FOUND: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "No element matched name=. Re-observe; names must match UIA Name."
  },
  UIA_INVOKE_FAILED: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "Invoke/click_input failed. Element may not support InvokePattern; try coords click."
  },
  UIA_ACT_FAILED: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "pywinauto act failed. Check focus, UIPI integrity, and that GUI is not minimized oddly."
  },
  UIA_HELPER_MISSING: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "scripts/desktop-uia-*.py or python3 missing."
  },
  UIA_EXEC_FAILED: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "Failed to exec UIA helper."
  },
  UIA_BAD_JSON: {
    severity: "error",
    surface: "desktop-windows",
    recovery: "UIA helper returned invalid JSON."
  },
  UIA_EMPTY: {
    severity: "warn",
    surface: "desktop-windows",
    recovery: "Empty helper stdout."
  },
  // AX
  AX_NOT_INSTALLED: {
    severity: "warn",
    surface: "desktop-macos",
    recovery: "pip install pyobjc-framework-ApplicationServices pyobjc-framework-Quartz pyobjc-framework-Cocoa"
  },
  AX_TCC_REQUIRED: {
    severity: "error",
    surface: "desktop-macos",
    recovery: "System Settings \u2192 Privacy & Security \u2192 Accessibility \u2014 allow Terminal/node (or the XClaw app)."
  },
  AX_WALK_FAILED: {
    severity: "error",
    surface: "desktop-macos",
    recovery: "AX tree walk failed. Grant Accessibility; retry with app= filter."
  },
  AX_ELEMENT_NOT_FOUND: {
    severity: "error",
    surface: "desktop-macos",
    recovery: "No AX element matched name=. Re-observe; titles must match AXTitle."
  },
  AX_INVOKE_FAILED: {
    severity: "error",
    surface: "desktop-macos",
    recovery: "AXPress and CGEvent fallback both failed. Check TCC and element visibility."
  },
  AX_ACT_FAILED: {
    severity: "error",
    surface: "desktop-macos",
    recovery: "CGEvent/AX act failed. Accessibility must be granted to the host process."
  },
  AX_HELPER_MISSING: {
    severity: "error",
    surface: "desktop-macos",
    recovery: "scripts/desktop-ax-*.py or python3 missing."
  },
  AX_EXEC_FAILED: {
    severity: "error",
    surface: "desktop-macos",
    recovery: "Failed to exec AX helper."
  },
  AX_BAD_JSON: {
    severity: "error",
    surface: "desktop-macos",
    recovery: "AX helper returned invalid JSON."
  },
  AX_EMPTY: {
    severity: "warn",
    surface: "desktop-macos",
    recovery: "Empty helper stdout."
  }
};
function enrichCuaError(result) {
  if (!result || result.ok === true || !result.code) return result;
  const entry = CUA_ERROR_CATALOG[result.code];
  if (!entry) return result;
  return {
    ...result,
    severity: result.severity || entry.severity,
    surface: result.surface || entry.surface,
    recovery: result.recovery || entry.recovery,
    hint: result.hint || entry.recovery
  };
}
function classifyCdpError(err) {
  const msg = String(err?.message || err || "");
  if (/not loopback|allowRemote/i.test(msg)) return "CDP_NOT_LOOPBACK";
  if (/no CDP page target|no page target/i.test(msg)) return "CDP_NO_PAGE";
  if (/socket closed|WebSocket.*close/i.test(msg)) return "CDP_SOCKET_CLOSED";
  if (/timeout|ETIMEDOUT/i.test(msg)) return "CDP_TIMEOUT";
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH/i.test(msg)) return "CDP_ATTACH_FAILED";
  if (/\/json\/|invalid JSON|CDP HTTP/i.test(msg)) return "CDP_HTTP_FAILED";
  if (/WS timeout|upgrade|websocket/i.test(msg)) return "CDP_WS_FAILED";
  if (/evaluate failed|exceptionDetails/i.test(msg)) return "CDP_EVAL_FAILED";
  if (/Page\.navigate|navigate failed/i.test(msg)) return "CDP_NAVIGATE_FAILED";
  if (/captureScreenshot|screenshot/i.test(msg)) return "CDP_SCREENSHOT_FAILED";
  if (/Input\.dispatch/i.test(msg)) return "CDP_INPUT_FAILED";
  if (/CDP attach/i.test(msg)) return "CDP_ATTACH_FAILED";
  return "CDP_ATTACH_FAILED";
}

// src/computer/cua-retry-metrics.mjs
import fs6 from "node:fs";
import path5 from "node:path";
import os2 from "node:os";
var state = {
  startedAt: (/* @__PURE__ */ new Date()).toISOString(),
  attempts: 0,
  successes: 0,
  failures: 0,
  retries: 0,
  retriedSuccesses: 0,
  byCode: /* @__PURE__ */ Object.create(null),
  delayMsTotal: 0,
  delayMsMax: 0,
  lastEvents: []
};
var MAX_EVENTS = 50;
function bumpCode(code, field) {
  if (!code) code = "unknown";
  if (!state.byCode[code]) {
    state.byCode[code] = { retries: 0, finalOk: 0, finalFail: 0 };
  }
  state.byCode[code][field] += 1;
}
function recordCuaRetryTick({ attempt, delayMs, code, error } = {}) {
  state.retries += 1;
  const d = Number(delayMs) || 0;
  state.delayMsTotal += d;
  if (d > state.delayMsMax) state.delayMsMax = d;
  if (code) bumpCode(code, "retries");
  const ev = {
    at: (/* @__PURE__ */ new Date()).toISOString(),
    type: "retry",
    attempt,
    delayMs: d,
    code: code || null,
    error: error ? String(error).slice(0, 160) : null
  };
  state.lastEvents.push(ev);
  if (state.lastEvents.length > MAX_EVENTS) state.lastEvents.shift();
  appendJsonl(ev);
}
function recordCuaRetryOutcome(result) {
  state.attempts += 1;
  const code = result?.code || (result?.ok ? "ok" : "unknown");
  if (result?.ok) {
    state.successes += 1;
    if (result.retried) state.retriedSuccesses += 1;
    bumpCode(result.retried ? `ok_after_retry` : "ok", "finalOk");
  } else {
    state.failures += 1;
    bumpCode(code, "finalFail");
  }
  const ev = {
    at: (/* @__PURE__ */ new Date()).toISOString(),
    type: "outcome",
    ok: !!result?.ok,
    code: result?.ok ? "ok" : code,
    retries: result?.retries ?? 0,
    retried: !!result?.retried
  };
  state.lastEvents.push(ev);
  if (state.lastEvents.length > MAX_EVENTS) state.lastEvents.shift();
  appendJsonl(ev);
}
function metricsPath() {
  const dir = process.env.XCLAW_CUA_METRICS_DIR || path5.join(process.env.HOME || os2.homedir() || "/tmp", ".xclaw", "metrics");
  return path5.join(dir, "cua-retry.jsonl");
}
function appendJsonl(ev) {
  if (process.env.XCLAW_CUA_METRICS === "0") return;
  try {
    const p = metricsPath();
    fs6.mkdirSync(path5.dirname(p), { recursive: true });
    fs6.appendFileSync(p, JSON.stringify(ev) + "\n");
  } catch {
  }
}

// src/computer/cua-retry.mjs
var CUA_TRANSIENT_CODES = /* @__PURE__ */ new Set([
  "CDP_ATTACH_FAILED",
  "CDP_NAVIGATE_FAILED",
  "CDP_INPUT_FAILED",
  "CDP_SCREENSHOT_FAILED",
  "CDP_NO_PAGE",
  "CDP_WS_FAILED",
  "CDP_HTTP_FAILED",
  "CDP_SOCKET_CLOSED",
  "CDP_TIMEOUT",
  "CUA_ACT_EXEC_FAILED",
  "ATSPI_EXEC_FAILED",
  "ATSPI_EMPTY",
  "ATSPI_REGISTRY_FAILED",
  "UIA_EXEC_FAILED",
  "UIA_EMPTY",
  "UIA_ACT_FAILED",
  "AX_EXEC_FAILED",
  "AX_EMPTY",
  "AX_ACT_FAILED",
  "OBSERVE_EXEC_FAILED",
  "DESKTOP_ACT_FAILED"
]);
function extractCuaCode(errOrResult) {
  if (!errOrResult) return null;
  if (typeof errOrResult === "object") {
    if (errOrResult.code) return String(errOrResult.code);
    if (errOrResult.message) return classifyCdpError(errOrResult);
  }
  if (errOrResult instanceof Error) {
    return classifyCdpError(errOrResult);
  }
  return null;
}
function isTransientCuaFailure(code, err = null) {
  if (code && CUA_TRANSIENT_CODES.has(code)) return true;
  if (err && /ECONNREFUSED|ETIMEDOUT|ECONNRESET|socket hang up|EPIPE/i.test(err.message || "")) {
    return true;
  }
  return false;
}
function sleep2(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("aborted"), { code: "ABORT_ERR" }));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(Object.assign(new Error("aborted"), { code: "ABORT_ERR" }));
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}
function backoffMs(attempt, opts = {}) {
  const base = opts.baseMs ?? 100;
  const max = opts.maxMs ?? 5e3;
  const factor = opts.factor ?? 2;
  const jitter = opts.jitter ?? 0.25;
  const raw = Math.min(max, base * factor ** attempt);
  const j = raw * jitter * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(raw + j));
}
async function withCuaRetry(fn, opts = {}) {
  const retries = Math.max(0, opts.retries ?? 2);
  const userOnRetry = opts.onRetry;
  const onRetry = (info) => {
    recordCuaRetryTick(info);
    userOnRetry?.(info);
  };
  const isRetryable = opts.isRetryable || ((result, err) => {
    if (err) return isTransientCuaFailure(extractCuaCode(err), err);
    if (result && result.ok === false) {
      return isTransientCuaFailure(result.code, null);
    }
    return false;
  });
  let lastResult = null;
  let lastErr = null;
  let attempts = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    attempts = attempt + 1;
    try {
      const result = await fn();
      lastResult = result;
      lastErr = null;
      if (result && result.ok === false && attempt < retries && isRetryable(result, null)) {
        const delay = backoffMs(attempt, opts);
        onRetry({
          attempt: attempt + 1,
          delayMs: delay,
          code: result.code,
          error: result.error
        });
        await sleep2(delay, opts.signal);
        continue;
      }
      if (result && typeof result === "object") {
        const out = {
          ...result,
          retries: attempts - 1,
          retried: attempts > 1
        };
        recordCuaRetryOutcome(out);
        return out;
      }
      return result;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < retries && isRetryable(null, lastErr)) {
        const delay = backoffMs(attempt, opts);
        onRetry({
          attempt: attempt + 1,
          delayMs: delay,
          code: extractCuaErrorCode(lastErr),
          error: lastErr.message
        });
        await sleep2(delay, opts.signal);
        continue;
      }
      recordCuaRetryOutcome({
        ok: false,
        code: extractCuaCode(lastErr) || "THROW",
        retries: attempts - 1,
        retried: attempts > 1
      });
      throw lastErr;
    }
  }
  if (lastResult && typeof lastResult === "object") {
    const out = { ...lastResult, retries: attempts - 1, retried: attempts > 1 };
    recordCuaRetryOutcome(out);
    return out;
  }
  if (lastErr) {
    recordCuaRetryOutcome({
      ok: false,
      code: extractCuaCode(lastErr) || "THROW",
      retries: attempts - 1,
      retried: attempts > 1
    });
    throw lastErr;
  }
  return lastResult;
}
function extractCuaErrorCode(err) {
  return extractCuaCode(err);
}

// src/computer/modules/desktop-driver.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os3 from "node:os";
import path6 from "node:path";
import { fileURLToPath } from "node:url";
var execFileAsync = promisify(execFile);
function probeDesktopDriver(env = process.env) {
  const platform = os3.platform();
  const enabled = env.XCLAW_DESKTOP_GUI === "1" || env.XCLAW_DESKTOP_GUI === "true";
  const forced = env.XCLAW_DESKTOP_BACKEND || null;
  return {
    platform,
    enabled,
    backend: forced,
    tools: { xdotool: null, ydotool: null },
    cuaOrder: "tools_first_then_browser_then_desktop"
  };
}
async function which(cmd) {
  try {
    const { stdout } = await execFileAsync("which", [cmd], { timeout: 2e3 });
    const p = String(stdout || "").trim();
    return p || null;
  } catch {
    return null;
  }
}
async function whichDesktopTools() {
  if (os3.platform() !== "linux") {
    return { xdotool: null, ydotool: null };
  }
  const [xdotool, ydotool] = await Promise.all([which("xdotool"), which("ydotool")]);
  return { xdotool, ydotool };
}
function atspiScriptPath() {
  const here = path6.dirname(fileURLToPath(import.meta.url));
  return path6.resolve(here, "../../../scripts/desktop-atspi-observe.py");
}
function uiaScriptPath() {
  const here = path6.dirname(fileURLToPath(import.meta.url));
  return path6.resolve(here, "../../../scripts/desktop-uia-observe.py");
}
function uiaActScriptPath() {
  const here = path6.dirname(fileURLToPath(import.meta.url));
  return path6.resolve(here, "../../../scripts/desktop-uia-act.py");
}
function axScriptPath() {
  const here = path6.dirname(fileURLToPath(import.meta.url));
  return path6.resolve(here, "../../../scripts/desktop-ax-observe.py");
}
function axActScriptPath() {
  const here = path6.dirname(fileURLToPath(import.meta.url));
  return path6.resolve(here, "../../../scripts/desktop-ax-act.py");
}
async function runPythonObserveHelper(scriptPath, input = {}, env = process.env, codes = {}) {
  const args = [scriptPath];
  if (input.app) args.push("--app", String(input.app));
  if (input.max) args.push("--max", String(Number(input.max) || 40));
  return withCuaRetry(
    async () => {
      try {
        const { stdout, stderr } = await execFileAsync("python3", args, {
          timeout: 15e3,
          env: { ...process.env, ...env },
          maxBuffer: 4 * 1024 * 1024
        });
        const raw = String(stdout || "").trim();
        if (!raw) {
          return { ok: false, error: stderr || "empty observe output", code: codes.empty || "OBSERVE_EMPTY" };
        }
        try {
          return JSON.parse(raw);
        } catch {
          return {
            ok: false,
            error: "invalid JSON from observe helper",
            code: codes.badJson || "OBSERVE_BAD_JSON",
            raw: raw.slice(0, 200)
          };
        }
      } catch (e) {
        const msg = e?.message || String(e);
        if (e?.stdout) {
          try {
            return JSON.parse(String(e.stdout));
          } catch {
          }
        }
        if (/No such file|ENOENT/i.test(msg)) {
          return {
            ok: false,
            error: "python3 or observe helper missing",
            code: codes.missing || "OBSERVE_HELPER_MISSING"
          };
        }
        return { ok: false, error: msg, code: codes.exec || "OBSERVE_EXEC_FAILED" };
      }
    },
    {
      retries: Number(env.XCLAW_CUA_RETRIES ?? process.env.XCLAW_CUA_RETRIES ?? 2),
      baseMs: Number(env.XCLAW_CUA_RETRY_BASE_MS ?? process.env.XCLAW_CUA_RETRY_BASE_MS ?? 100),
      maxMs: Number(env.XCLAW_CUA_RETRY_MAX_MS ?? process.env.XCLAW_CUA_RETRY_MAX_MS ?? 2500)
    }
  );
}
async function runDesktopObserveImpl(input = {}, env = process.env) {
  const probe = probeDesktopDriver(env);
  if (probe.platform === "linux") {
    return runPythonObserveHelper(atspiScriptPath(), input, env, {
      empty: "ATSPI_EMPTY",
      badJson: "ATSPI_BAD_JSON",
      missing: "ATSPI_HELPER_MISSING",
      exec: "ATSPI_EXEC_FAILED"
    });
  }
  if (probe.platform === "win32") {
    return runPythonObserveHelper(uiaScriptPath(), input, env, {
      empty: "UIA_EMPTY",
      badJson: "UIA_BAD_JSON",
      missing: "UIA_HELPER_MISSING",
      exec: "UIA_EXEC_FAILED"
    });
  }
  if (probe.platform === "darwin") {
    return runPythonObserveHelper(axScriptPath(), input, env, {
      empty: "AX_EMPTY",
      badJson: "AX_BAD_JSON",
      missing: "AX_HELPER_MISSING",
      exec: "AX_EXEC_FAILED"
    });
  }
  return {
    ok: false,
    error: `desktop observe not implemented for ${probe.platform}`,
    code: "DESKTOP_OBSERVE_UNSUPPORTED_OS",
    platform: probe.platform
  };
}
async function runDesktopActImpl(input = {}, env = process.env) {
  const probe = probeDesktopDriver(env);
  if (!probe.enabled) {
    return {
      ok: false,
      error: "Desktop GUI disabled. Browser CDP (XCLAW_CDP_URL) is preferred. Opt-in: XCLAW_DESKTOP_GUI=1 (lab only).",
      code: "DESKTOP_GUI_DISABLED",
      platform: probe.platform,
      cuaPolicy: probe.cuaOrder
    };
  }
  const action = String(input.action || "click").toLowerCase();
  if (probe.platform === "win32") {
    const script = uiaActScriptPath();
    const args = [script, action];
    if (action === "click") {
      if (!Number.isFinite(Number(input.x)) || !Number.isFinite(Number(input.y))) {
        return { ok: false, error: "desktop click requires x,y", code: "DESKTOP_NEED_COORDS" };
      }
      args.push("--x", String(input.x), "--y", String(input.y));
      if (input.button) args.push("--button", String(input.button));
    } else if (action === "type") {
      args.push("--text", String(input.text ?? ""));
    } else if (action === "key") {
      if (!input.key) return { ok: false, error: "key required", code: "DESKTOP_NEED_KEY" };
      args.push("--key", String(input.key));
    } else if (action === "invoke") {
      if (input.title) args.push("--title", String(input.title));
      if (input.name || input.ref) args.push("--name", String(input.name || input.ref));
      else return { ok: false, error: "invoke requires name", code: "DESKTOP_NEED_NAME" };
    } else {
      return { ok: false, error: `unsupported desktop action: ${action}`, code: "DESKTOP_ACT_UNKNOWN" };
    }
    try {
      const { stdout } = await execFileAsync("python3", args, {
        timeout: 15e3,
        env: { ...process.env, ...env },
        maxBuffer: 2 * 1024 * 1024
      });
      const raw = String(stdout || "").trim();
      try {
        return JSON.parse(raw);
      } catch {
        return { ok: false, error: "invalid JSON from UIA act helper", code: "UIA_BAD_JSON", raw: raw.slice(0, 200) };
      }
    } catch (e) {
      if (e?.stdout) {
        try {
          return JSON.parse(String(e.stdout));
        } catch {
        }
      }
      return {
        ok: false,
        error: e?.message || String(e),
        code: "UIA_ACT_FAILED"
      };
    }
  }
  if (probe.platform === "darwin") {
    const script = axActScriptPath();
    const args = [script, action];
    if (action === "click") {
      if (!Number.isFinite(Number(input.x)) || !Number.isFinite(Number(input.y))) {
        return { ok: false, error: "desktop click requires x,y", code: "DESKTOP_NEED_COORDS" };
      }
      args.push("--x", String(input.x), "--y", String(input.y));
      if (input.button) args.push("--button", String(input.button));
    } else if (action === "type") {
      args.push("--text", String(input.text ?? ""));
    } else if (action === "key") {
      if (!input.key) return { ok: false, error: "key required", code: "DESKTOP_NEED_KEY" };
      args.push("--key", String(input.key));
    } else if (action === "invoke") {
      if (input.app) args.push("--app", String(input.app));
      if (input.name || input.ref) args.push("--name", String(input.name || input.ref));
      else return { ok: false, error: "invoke requires name", code: "DESKTOP_NEED_NAME" };
    } else {
      return { ok: false, error: `unsupported desktop action: ${action}`, code: "DESKTOP_ACT_UNKNOWN" };
    }
    try {
      const { stdout } = await execFileAsync("python3", args, {
        timeout: 15e3,
        env: { ...process.env, ...env },
        maxBuffer: 2 * 1024 * 1024
      });
      const raw = String(stdout || "").trim();
      try {
        return JSON.parse(raw);
      } catch {
        return { ok: false, error: "invalid JSON from AX act helper", code: "AX_BAD_JSON", raw: raw.slice(0, 200) };
      }
    } catch (e) {
      if (e?.stdout) {
        try {
          return JSON.parse(String(e.stdout));
        } catch {
        }
      }
      return { ok: false, error: e?.message || String(e), code: "AX_ACT_FAILED" };
    }
  }
  if (probe.platform !== "linux") {
    return {
      ok: false,
      error: `DesktopDriver act not implemented for ${probe.platform}. Use browser CDP for GUI.`,
      code: "DESKTOP_GUI_UNSUPPORTED_OS",
      platform: probe.platform
    };
  }
  const tools = await whichDesktopTools();
  const backend = probe.backend || (tools.xdotool ? "xdotool" : tools.ydotool ? "ydotool" : null);
  if (!backend) {
    return {
      ok: false,
      error: "No xdotool/ydotool on PATH. Install xdotool or set XCLAW_CDP_URL for browser GUI.",
      code: "DESKTOP_GUI_NO_BACKEND",
      platform: "linux",
      tools
    };
  }
  const bin = backend === "ydotool" ? tools.ydotool : tools.xdotool;
  try {
    if (action === "click") {
      const x = Number(input.x);
      const y = Number(input.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, error: "desktop click requires x,y", code: "DESKTOP_NEED_COORDS" };
      }
      if (backend === "xdotool") {
        await execFileAsync(
          bin,
          ["mousemove", String(Math.round(x)), String(Math.round(y)), "click", "1"],
          { timeout: 5e3 }
        );
      } else {
        await execFileAsync(
          bin,
          ["mousemove", "--absolute", "-x", String(Math.round(x)), "-y", String(Math.round(y))],
          { timeout: 5e3 }
        );
        await execFileAsync(bin, ["click", "0xC0"], { timeout: 3e3 });
      }
      return { ok: true, action: "click", backend, x, y, engine: "desktop-driver" };
    }
    if (action === "type") {
      const text = String(input.text ?? "");
      if (backend === "xdotool") {
        await execFileAsync(bin, ["type", "--", text], { timeout: 15e3 });
      } else {
        await execFileAsync(bin, ["type", text], { timeout: 15e3 });
      }
      return { ok: true, action: "type", backend, engine: "desktop-driver" };
    }
    if (action === "key") {
      const key = String(input.key || "");
      if (!key) return { ok: false, error: "key required", code: "DESKTOP_NEED_KEY" };
      await execFileAsync(bin, ["key", key], { timeout: 5e3 });
      return { ok: true, action: "key", key, backend, engine: "desktop-driver" };
    }
    return {
      ok: false,
      error: `unsupported desktop action: ${action}`,
      code: "DESKTOP_ACT_UNKNOWN"
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e),
      code: "DESKTOP_ACT_FAILED",
      backend
    };
  }
}
async function runDesktopObserve(input = {}, env = process.env) {
  return enrichCuaError(await runDesktopObserveImpl(input, env));
}
async function runDesktopAct(input = {}, env = process.env) {
  return enrichCuaError(await runDesktopActImpl(input, env));
}

// src/computer/modules/computer-act-tool.mjs
var observeCache = /* @__PURE__ */ new Map();
function cacheObserveResult(tabId, payload = {}) {
  if (!tabId) return;
  observeCache.set(String(tabId), {
    elements: Array.isArray(payload.elements) ? payload.elements : [],
    at: Date.now(),
    url: payload.url
  });
  if (observeCache.size > 32) {
    const first = observeCache.keys().next().value;
    observeCache.delete(first);
  }
}
function getCachedObserve(tabId) {
  return tabId ? observeCache.get(String(tabId)) || null : null;
}
async function resolveClickTarget(tab, input = {}) {
  let x = Number(input.x);
  let y = Number(input.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { x, y, source: "explicit" };
  }
  const ref = input.ref ? String(input.ref) : "";
  const nameHint = input.label || input.name || "";
  let searchName = nameHint;
  if (ref && input.tabId) {
    const cached = getCachedObserve(input.tabId);
    const el = cached?.elements?.find((e) => e.ref === ref);
    if (el?.name) searchName = el.name;
  }
  if (!ref && !searchName) {
    return null;
  }
  const expr = `(() => {
    const ref = ${JSON.stringify(ref)};
    const name = ${JSON.stringify(searchName)};
    const candidates = [];
    const push = (node, role) => {
      if (!node) return;
      const r = node.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const label = (node.getAttribute('aria-label') || node.innerText || node.value || node.getAttribute('name') || node.getAttribute('placeholder') || '').trim().slice(0, 160);
      candidates.push({ role, label, x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height });
    };
    document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"]').forEach((n) => {
      const role = n.getAttribute('role') || n.tagName.toLowerCase();
      push(n, role);
    });
    let hit = null;
    if (ref && /^ed+$/i.test(ref)) {
      const idx = parseInt(ref.slice(1), 10) - 1;
      if (idx >= 0 && idx < candidates.length) hit = candidates[idx];
    }
    if (!hit && name) {
      const lower = name.toLowerCase();
      hit = candidates.find((c) => c.label.toLowerCase().includes(lower)) || null;
    }
    return hit;
  })()`;
  try {
    const hit = await tab.evaluate(expr);
    if (hit && Number.isFinite(hit.x) && Number.isFinite(hit.y)) {
      return { x: hit.x, y: hit.y, source: "cdp-ref", label: hit.label, role: hit.role };
    }
  } catch (e) {
    return { error: e?.message || String(e) };
  }
  return null;
}
function parseCdpUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(String(raw));
    return {
      host: u.hostname || "127.0.0.1",
      port: Number(u.port) || 9222
    };
  } catch {
    return null;
  }
}
function resolveCdpEndpoint() {
  const raw = process.env.XCLAW_CDP_URL || process.env.CDP_URL || null;
  return parseCdpUrl(raw);
}
async function runComputerActImpl(input = {}) {
  const action = String(input.action || "click").toLowerCase();
  if (action === "observe") {
    return {
      ok: false,
      error: "Use xclaw_browser_tab with action=observe (structure). computer_act is for GUI actuation only.",
      code: "USE_BROWSER_OBSERVE",
      engine: process.env.XCLAW_COMPUTER_ENGINE || "native"
    };
  }
  if (input.surface === "desktop" || input.desktop === true) {
    const a = String(input.action || "click").toLowerCase();
    if (a === "observe") {
      const obs = await runDesktopObserve(input);
      if (obs?.ok && obs.elements) {
        try {
          cacheObserveResult(input.tabId || "desktop", obs);
        } catch {
        }
      }
      return obs;
    }
    return runDesktopAct(input);
  }
  if (action === "navigate") {
    const url = String(input.url || input.href || "").trim();
    if (!url) {
      return {
        ok: false,
        error: "navigate requires url",
        code: "CUA_ACT_NEED_URL",
        engine: "native"
      };
    }
  }
  const engine = process.env.XCLAW_COMPUTER_ENGINE || "native";
  const cdpEp = resolveCdpEndpoint();
  const canAct = Boolean(cdpEp) || engine === "bundle" || engine === "generated";
  if (!canAct) {
    return {
      ok: false,
      error: "GUI actuation (click/type/key/scroll/screenshot) requires XCLAW_CDP_URL or CDP bundle. Prefer tools/APIs, then xclaw_browser_tab action=observe.",
      code: "CUA_ACT_REQUIRES_BUNDLE",
      engine: engine === "thin" ? "native" : engine,
      cuaPolicy: "tools_first_then_observe_then_gui",
      hint: "export XCLAW_CDP_URL=http://127.0.0.1:9222  # or XCLAW_COMPUTER_ENGINE=bundle"
    };
  }
  if (!cdpEp) {
    return {
      ok: false,
      error: "engine=bundle without XCLAW_CDP_URL: BrowserService actuation is still BUNDLE_ONLY. Attach CDP for CLEAN motor path, or extract BrowserService modules.",
      code: "CUA_ACT_NOT_EXTRACTED",
      engine,
      cuaPolicy: "tools_first_then_observe_then_gui",
      hint: "export XCLAW_CDP_URL=http://127.0.0.1:9222"
    };
  }
  let client;
  let tab;
  try {
    const attachResult = await withCuaRetry(
      async () => {
        client = createCdpClient({ host: cdpEp.host, port: cdpEp.port });
        tab = await client.attach(input.urlMatch || void 0);
        return { ok: true, tab };
      },
      {
        retries: Number(process.env.XCLAW_CUA_RETRIES ?? 2),
        baseMs: Number(process.env.XCLAW_CUA_RETRY_BASE_MS ?? 120),
        maxMs: Number(process.env.XCLAW_CUA_RETRY_MAX_MS ?? 3e3)
      }
    );
    tab = attachResult.tab || tab;
  } catch (e) {
    const code = classifyCdpError(e);
    return {
      ok: false,
      error: `CDP attach failed: ${e?.message || e}`,
      code,
      engine,
      cdp: cdpEp,
      retries: Number(process.env.XCLAW_CUA_RETRIES ?? 2)
    };
  }
  try {
    if (action === "navigate") {
      const url = String(input.url || input.href || "").trim();
      if (!url) {
        return {
          ok: false,
          error: "navigate requires url",
          code: "CUA_ACT_NEED_URL",
          engine: "cdp-motor"
        };
      }
      try {
        await tab.navigate(url);
        try {
          await tab.send("Page.enable");
          await new Promise((r) => setTimeout(r, Number(input.waitMs) || 400));
        } catch {
        }
        let pageUrl = null;
        try {
          pageUrl = await tab.evaluate("location.href");
        } catch {
          pageUrl = url;
        }
        return {
          ok: true,
          action: "navigate",
          engine: "cdp-motor",
          url,
          pageUrl,
          cuaPolicy: "tools_first_then_observe_then_gui"
        };
      } catch (e) {
        return {
          ok: false,
          error: e?.message || String(e),
          code: classifyCdpError(e) === "CDP_ATTACH_FAILED" ? "CDP_NAVIGATE_FAILED" : classifyCdpError(e),
          engine: "cdp-motor",
          url
        };
      }
    }
    if (action === "screenshot") {
      const buf = await tab.screenshot();
      const b64 = buf.toString("base64");
      return {
        ok: true,
        action: "screenshot",
        engine: "cdp-motor",
        mime: "image/png",
        bytes: buf.length,
        /** callers may persist; we return prefix only in metadata-heavy logs */
        dataBase64Length: b64.length,
        dataBase64: b64.slice(0, 120) + (b64.length > 120 ? "\u2026" : ""),
        pageUrl: tab.page?.url || null
      };
    }
    let plan;
    if (action === "click") {
      const target = await resolveClickTarget(tab, input);
      if (!target || target.error) {
        return {
          ok: false,
          error: target?.error || "click requires x,y or resolvable ref/name (run observe, pass ref or label)",
          code: "CUA_ACT_NEED_COORDS",
          engine: "cdp-motor"
        };
      }
      const x = target.x;
      const y = target.y;
      plan = planClick({
        x,
        y,
        button: input.button || "left",
        clickCount: input.clickCount || 1,
        label: target.label || input.ref || input.label
      });
      plan.meta = { ...plan.meta, coordSource: target.source };
    } else if (action === "type") {
      plan = planType({ text: input.text ?? "" });
    } else if (action === "scroll") {
      plan = planScroll({
        x: Number(input.x) || 0,
        y: Number(input.y) || 0,
        deltaX: Number(input.deltaX) || 0,
        deltaY: Number(input.deltaY) || 100
      });
    } else if (action === "key") {
      const key = String(input.key || "");
      if (!key) {
        return { ok: false, error: "key requires key string", code: "CUA_ACT_NEED_KEY" };
      }
      await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key });
      await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key });
      return {
        ok: true,
        action: "key",
        engine: "cdp-motor",
        key,
        pageUrl: tab.page?.url || null
      };
    } else {
      return {
        ok: false,
        error: `unsupported action: ${action}`,
        code: "CUA_ACT_UNKNOWN"
      };
    }
    const result = await withCuaRetry(
      async () => {
        const r = await executeSteps(tab, plan.steps);
        if (r && r.ok === false) {
          return {
            ok: false,
            error: r.error || "executeSteps failed",
            code: "CUA_ACT_EXEC_FAILED",
            engine: "cdp-motor"
          };
        }
        return {
          ok: true,
          action,
          engine: "cdp-motor",
          executed: r.executed,
          total: r.total,
          meta: plan.meta,
          pageUrl: tab.page?.url || null,
          cuaPolicy: "tools_first_then_observe_then_gui"
        };
      },
      {
        retries: Number(process.env.XCLAW_CUA_RETRIES ?? 2),
        baseMs: Number(process.env.XCLAW_CUA_RETRY_BASE_MS ?? 80),
        maxMs: Number(process.env.XCLAW_CUA_RETRY_MAX_MS ?? 2e3)
      }
    );
    return result;
  } catch (e) {
    const code = classifyCdpError(e);
    return {
      ok: false,
      error: e?.message || String(e),
      code: code === "CDP_ATTACH_FAILED" ? "CUA_ACT_EXEC_FAILED" : code,
      engine: "cdp-motor"
    };
  } finally {
    try {
      tab?.close?.();
    } catch {
    }
  }
}
var ComputerActTool = {
  name: "xclaw_computer_act",
  description: "CUA GUI actuation via CDP (navigate/click/type/key/scroll/screenshot) when XCLAW_CDP_URL is set. Prefer connectors/tools and xclaw_browser_tab observe first. Supports navigate when CDP is attached. Native without CDP fails closed.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "navigate | click | type | key | scroll | screenshot"
      },
      tabId: { type: "string" },
      url: { type: "string", description: "Target URL for action=navigate" },
      urlMatch: { type: "string", description: "Pick CDP page by URL substring" },
      ref: { type: "string", description: "Element ref from observe (label only until ref\u2192coords)" },
      x: { type: "number" },
      y: { type: "number" },
      text: { type: "string" },
      key: { type: "string" },
      deltaX: { type: "number" },
      deltaY: { type: "number" },
      button: { type: "string" },
      clickCount: { type: "number" }
    }
  },
  isReadOnly: () => false,
  async call(input, _ctx = {}) {
    const data = await runComputerAct(input || {});
    return { data };
  }
};
async function runComputerAct(input) {
  const r = await runComputerActImpl(input);
  return enrichCuaError(r);
}

// src/computer/modules/browser-tab-tool.mjs
var tabs = /* @__PURE__ */ new Map();
var seq = 0;
function nextId() {
  seq += 1;
  return `tab_${seq}_${Date.now().toString(36)}`;
}
function ssrfCfg() {
  return {
    security: {
      ssrf: {
        allowPrivate: process.env.XCLAW_SSRF_ALLOW_PRIVATE === "1"
      }
    }
  };
}
async function fetchUrl(urlStr, timeoutMs = 15e3) {
  const res = await safeFetch(
    urlStr,
    {
      headers: {
        "user-agent": "XClawNativeBrowser/3.75 (+https://github.com/Matrixx0070/xclaw; native-fetch)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9"
      },
      timeoutMs,
      maxBytes: 2e6
    },
    ssrfCfg(),
    { metadataFloor: true }
  );
  return {
    status: res.status,
    body: await res.text(),
    finalUrl: res.url || urlStr
  };
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
      href = new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    if (href.startsWith("http://") || href.startsWith("https://")) {
      links.push({ href, label: label || null });
    }
  }
  return links;
}
function extractInteractiveElements(html, baseUrl, limit = 40) {
  const elements = [];
  const push = (el) => {
    if (elements.length >= limit) return;
    elements.push(el);
  };
  const strip = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRe.exec(html)) && elements.length < limit) {
    const attrs = m[1];
    const hrefM = attrs.match(/href=["']([^"']+)["']/i);
    let href = hrefM ? hrefM[1] : null;
    if (href) {
      try {
        href = new URL(href, baseUrl).href;
      } catch {
      }
    }
    const name = strip(m[2]) || (attrs.match(/aria-label=["']([^"']+)["']/i) || [])[1] || (attrs.match(/title=["']([^"']+)["']/i) || [])[1] || href || "link";
    push({
      ref: `e${elements.length + 1}`,
      role: "link",
      name,
      href: href || void 0,
      tag: "a"
    });
  }
  const btnRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  while ((m = btnRe.exec(html)) && elements.length < limit) {
    const attrs = m[1];
    const name = strip(m[2]) || (attrs.match(/aria-label=["']([^"']+)["']/i) || [])[1] || (attrs.match(/name=["']([^"']+)["']/i) || [])[1] || "button";
    const disabled = /\bdisabled\b/i.test(attrs);
    push({
      ref: `e${elements.length + 1}`,
      role: "button",
      name,
      disabled: disabled || void 0,
      tag: "button"
    });
  }
  const inputRe = /<(input|textarea|select)\b([^>]*)\/?>/gi;
  while ((m = inputRe.exec(html)) && elements.length < limit) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const typeM = attrs.match(/\btype=["']([^"']+)["']/i);
    const type = (typeM ? typeM[1] : tag === "input" ? "text" : tag).toLowerCase();
    if (type === "hidden") continue;
    const name = (attrs.match(/aria-label=["']([^"']+)["']/i) || [])[1] || (attrs.match(/placeholder=["']([^"']+)["']/i) || [])[1] || (attrs.match(/\bname=["']([^"']+)["']/i) || [])[1] || (attrs.match(/\bid=["']([^"']+)["']/i) || [])[1] || type;
    const role = type === "submit" || type === "button" ? "button" : type === "checkbox" ? "checkbox" : type === "radio" ? "radio" : tag === "select" ? "combobox" : "textbox";
    push({
      ref: `e${elements.length + 1}`,
      role,
      name: strip(name),
      tag,
      inputType: type !== tag ? type : void 0
    });
  }
  return elements;
}
function observeFromTab(tab) {
  const html = tab.html || "";
  const elements = html ? extractInteractiveElements(html, tab.url || "https://example.invalid") : (tab.links || []).map((l, i) => ({
    ref: `e${i + 1}`,
    role: "link",
    name: l.label || l.href,
    href: l.href,
    tag: "a"
  }));
  const payload = {
    ok: true,
    action: "observe",
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    status: tab.status,
    engine: "native-fetch",
    mode: "html-structure",
    /** Structured candidates — prefer over screenshot for planning */
    elements,
    elementCount: elements.length,
    textPreview: String(tab.text || "").slice(0, 3e3),
    links: (tab.links || []).slice(0, 15),
    notes: "Native observe is HTML-derived (not OS accessibility). For real AX tree + click/type use XCLAW_COMPUTER_ENGINE=bundle or CDP attach."
  };
  try {
    cacheObserveResult(tab.id, payload);
  } catch {
  }
  return payload;
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
      error: "jsCode requires the CDP bundle engine. Set XCLAW_COMPUTER_ENGINE=bundle (npm run fetch:bundle). See docs/BROWSER_UNBUNDLE.md",
      tabId: input.tabId || null,
      engine: "native-fetch"
    };
  }
  if (input.screenshot) {
    return {
      ok: false,
      error: "screenshot requires the CDP bundle engine. Prefer action=observe on native for structure. See docs/BROWSER_UNBUNDLE.md",
      tabId: input.tabId || null,
      engine: "native-fetch"
    };
  }
  if (input.click || input.type || action === "click" || action === "type") {
    return {
      ok: false,
      error: "click/type require CDP bundle or attached Chromium (XCLAW_CDP_URL). On native, use action=observe then tools/API; do not invent coordinates.",
      tabId: input.tabId || null,
      engine: "native-fetch",
      code: "CUA_ACT_REQUIRES_BUNDLE"
    };
  }
  if (action === "list" || !input.url && !input.tabId && action !== "read" && action !== "observe") {
    return {
      ok: true,
      action: "list",
      tabs: listTabs(),
      count: tabs.size,
      engine: "native-fetch"
    };
  }
  if (action === "observe") {
    if (!input.tabId) {
      return {
        ok: false,
        error: "observe requires tabId (navigate first)",
        engine: "native-fetch"
      };
    }
    const tab2 = tabs.get(input.tabId);
    if (!tab2) {
      return { ok: false, error: `Unknown tabId: ${input.tabId}`, tabId: input.tabId };
    }
    return observeFromTab(tab2);
  }
  if (action === "read" || input.tabId && !input.url && action !== "observe") {
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
      error: "url required for navigate (or action=list|read|observe with tabId)",
      engine: "native-fetch"
    };
  }
  let res;
  try {
    res = await fetchUrl(input.url);
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
      code: err?.code || null,
      url: input.url,
      engine: "native-fetch"
    };
  }
  const title = extractTitle(res.body);
  const description = extractMetaDescription(res.body);
  const text = htmlToText(res.body);
  const links = extractLinks(res.body, res.finalUrl || input.url);
  const id = input.tabId && tabs.has(input.tabId) ? input.tabId : nextId();
  const finalUrl = res.finalUrl || input.url;
  const requestId = `req_${id}`;
  const networkEntry = {
    requestId,
    method: "GET",
    url: finalUrl,
    status: res.status,
    requestHeaders: {
      "user-agent": "XClawNativeBrowser/3.75",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    responseHeaders: {
      "content-type": "text/html; charset=utf-8"
    },
    responseBodyPreview: String(res.body || "").slice(0, 8e3),
    responseBodyBytes: Buffer.byteLength(String(res.body || ""), "utf8"),
    at: (/* @__PURE__ */ new Date()).toISOString()
  };
  const tab = {
    id,
    url: finalUrl,
    title,
    description,
    text,
    links,
    /** keep HTML for observe (capped) */
    html: String(res.body || "").slice(0, 5e5),
    status: res.status,
    at: (/* @__PURE__ */ new Date()).toISOString(),
    network: [networkEntry]
  };
  tabs.set(id, tab);
  const out = {
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
    networkSummaries: input.includeNetwork ? tab.network.map((n) => ({
      requestId: n.requestId,
      method: n.method,
      url: n.url,
      status: n.status
    })) : void 0
  };
  if (input.observe === true || action === "navigate_observe") {
    const obs = observeFromTab(tab);
    out.elements = obs.elements;
    out.elementCount = obs.elementCount;
    out.mode = obs.mode;
  }
  return out;
}
function getTab(tabId) {
  return tabs.get(tabId) || null;
}
function listTabNetwork(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return null;
  return tab.network || [];
}
function getNetworkEntry(tabId, requestId) {
  const list = listTabNetwork(tabId);
  if (!list) return null;
  if (requestId) return list.find((n) => n.requestId === requestId) || null;
  return list[list.length - 1] || null;
}
var BrowserTabTool = {
  name: "xclaw_browser_tab",
  description: "Browser plane (CUA-aware): navigate/fetch URL, list/read tabs, action=observe for structured interactive elements (HTML a11y-like tree). Prefer observe before screenshot. jsCode/screenshot/click/type require CDP bundle (XCLAW_COMPUTER_ENGINE=bundle or XCLAW_CDP_URL). See docs/BROWSER_UNBUNDLE.md and docs/COMPUTER_USE_BACKEND.md.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "navigate | list | read | observe (default: navigate if url set). observe requires tabId."
      },
      url: { type: "string", description: "URL for navigate" },
      tabId: { type: "string", description: "Tab id for read/observe/list targeting" },
      observe: {
        type: "boolean",
        description: "If true on navigate, also return elements[] (same as action=observe)"
      },
      jsCode: { type: "string", description: "Bundle/CDP only" },
      screenshot: { type: "string", description: "Bundle/CDP only \u2014 prefer action=observe on native" },
      includeNetwork: { type: "boolean" },
      click: { type: "string", description: "Bundle/CDP only" },
      type: { type: "string", description: "Bundle/CDP only" }
    }
  },
  isReadOnly: () => true,
  async call(input, _context = {}) {
    const data = await runBrowserTab(input || {});
    return { data };
  }
};

// src/computer/modules/browser-network-details-tool.mjs
async function runBrowserNetworkDetails(input = {}) {
  const tabId = String(input.tabId || "").trim();
  if (!tabId) {
    return {
      ok: false,
      error: "tabId is required",
      engine: "native-fetch"
    };
  }
  const tab = getTab(tabId);
  if (!tab) {
    return {
      ok: false,
      error: `Unknown tabId: ${tabId}`,
      tabId,
      engine: "native-fetch",
      hint: "Navigate with xclaw_browser_tab first (native engine)."
    };
  }
  const requestId = input.requestId ? String(input.requestId) : null;
  const entry = getNetworkEntry(tabId, requestId);
  if (!entry) {
    return {
      ok: false,
      error: requestId ? `No network entry requestId=${requestId} on tab ${tabId}` : `No network entries on tab ${tabId}`,
      tabId,
      available: listTabNetwork(tabId)?.map((n) => n.requestId) || [],
      engine: "native-fetch"
    };
  }
  const includeBody = input.includeBody !== false;
  return {
    ok: true,
    engine: "native-fetch",
    tabId,
    requestId: entry.requestId,
    method: entry.method,
    url: entry.url,
    status: entry.status,
    requestHeaders: entry.requestHeaders || {},
    responseHeaders: entry.responseHeaders || {},
    responseBodyBytes: entry.responseBodyBytes ?? null,
    responseBodyPreview: includeBody ? entry.responseBodyPreview || null : null,
    at: entry.at,
    note: "Native engine records the primary navigation request. Multi-resource CDP capture requires computer.engine=bundle."
  };
}
var BrowserNetworkDetailsTool = {
  name: "xclaw_browser_network_details",
  description: "Inspect network details for a native browser tab (headers, status, body preview). Requires prior xclaw_browser_tab navigate.",
  inputSchema: {
    type: "object",
    properties: {
      tabId: { type: "string", description: "Tab id from xclaw_browser_tab" },
      requestId: {
        type: "string",
        description: "Optional request id; defaults to latest on the tab"
      },
      includeBody: {
        type: "boolean",
        description: "Include response body preview (default true, capped)"
      }
    },
    required: ["tabId"]
  },
  isReadOnly: () => true,
  async call(input, _ctx = {}) {
    const data = await runBrowserNetworkDetails(input || {});
    return { data };
  }
};

// src/computer/modules/registry.mjs
var MAINTAINED_TOOLS = [
  BashTool,
  FileReadTool,
  FileWriteTool,
  FileEditTool,
  BrowserTabTool,
  BrowserNetworkDetailsTool,
  ComputerActTool
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
import fs7 from "node:fs/promises";
import path7 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var root = path7.resolve(path7.dirname(fileURLToPath2(import.meta.url)), "../..");
async function loadModuleMap() {
  const p = path7.join(root, "src/computer/MODULE_MAP.json");
  const raw = await fs7.readFile(p, "utf8");
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
      "browser-tab-tool \u2192 full CDP via the bundle engine (XCLAW_COMPUTER_ENGINE=bundle)",
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
  const server = http3.createServer(async (req, res) => {
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
        const id = `sess_${crypto4.randomBytes(8).toString("hex")}`;
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
