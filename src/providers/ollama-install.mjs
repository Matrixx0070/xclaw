/**
 * One-command Ollama setup for `xclaw providers install ollama`.
 *
 * Orchestrates: install the runtime if missing → ensure the daemon is up →
 * pull a default model → report readiness. Every step is idempotent and safe to
 * re-run. No secrets involved (local runtime); the SEPARATE Ollama *cloud* API
 * key is handled by the normal per-provider apikey credential (routes to
 * ollamaCloudBaseUrl in registry).
 */
import { spawn } from "node:child_process";

const LOCAL_BASE = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "llama3.2";
const INSTALL_URL = "https://ollama.com/install.sh";

/** Run a command, streaming nothing; resolve { ok, code, out }. */
function run(cmd, args, { timeoutMs = 600_000, env } = {}) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const child = spawn(cmd, args, { env: { ...process.env, ...env } });
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try { child.kill("SIGKILL"); } catch { /* */ }
        resolve({ ok: false, code: null, out, error: `timeout after ${timeoutMs}ms` });
      }
    }, timeoutMs);
    if (timer.unref) timer.unref();
    child.stdout?.on("data", (d) => { out += d; });
    child.stderr?.on("data", (d) => { out += d; });
    child.on("error", (e) => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ ok: false, code: null, out, error: e.message });
    });
    child.on("close", (code) => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ ok: code === 0, code, out });
    });
  });
}

export async function isOllamaInstalled() {
  const r = await run("ollama", ["--version"], { timeoutMs: 8_000 });
  return r.ok;
}

/** GET the local daemon version; true when reachable. */
export async function isDaemonUp(base = LOCAL_BASE, timeoutMs = 3_000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${base}/api/version`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** Install the Ollama runtime via the official script (Linux/macOS). */
export async function installRuntime({ onLog = () => {} } = {}) {
  if (await isOllamaInstalled()) return { ok: true, alreadyInstalled: true };
  if (process.platform === "win32") {
    return {
      ok: false,
      error:
        "Automatic install is Linux/macOS only. On Windows, download from https://ollama.com/download, then re-run `xclaw providers install ollama`.",
    };
  }
  onLog(`installing Ollama runtime (curl ${INSTALL_URL} | sh) …`);
  // Pipe the installer through sh; needs network + (often) sudo for /usr/local.
  const r = await run("sh", ["-c", `curl -fsSL ${INSTALL_URL} | sh`], { timeoutMs: 600_000 });
  if (!r.ok) return { ok: false, error: `installer failed (code ${r.code})`, out: r.out.slice(-800) };
  const installed = await isOllamaInstalled();
  return installed
    ? { ok: true, installed: true }
    : { ok: false, error: "installer ran but `ollama` still not on PATH", out: r.out.slice(-800) };
}

/** Ensure the daemon is running; start `ollama serve` detached if not. */
export async function ensureDaemon({ base = LOCAL_BASE, onLog = () => {} } = {}) {
  if (await isDaemonUp(base)) return { ok: true, alreadyUp: true };
  onLog("starting Ollama daemon (ollama serve) …");
  // Detached so it outlives this process; ignore stdio.
  try {
    const child = spawn("ollama", ["serve"], { detached: true, stdio: "ignore" });
    child.unref();
  } catch (e) {
    return { ok: false, error: `could not spawn ollama serve: ${e.message}` };
  }
  // Poll up to ~15s for the daemon to accept connections.
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isDaemonUp(base)) return { ok: true, started: true };
  }
  return { ok: false, error: "daemon did not come up within 15s" };
}

/** Pull a model (idempotent — Ollama skips if present). */
export async function pullModel(model = DEFAULT_MODEL, { onLog = () => {} } = {}) {
  onLog(`pulling model ${model} (first run downloads; re-runs are instant) …`);
  const r = await run("ollama", ["pull", model], { timeoutMs: 1_800_000 });
  return r.ok
    ? { ok: true, model }
    : { ok: false, model, error: `pull failed (code ${r.code})`, out: r.out.slice(-400) };
}

/** List locally-available models via the daemon. */
export async function localModels(base = LOCAL_BASE) {
  try {
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) return [];
    const j = await res.json();
    return (j.models || []).map((m) => m.name);
  } catch {
    return [];
  }
}

/**
 * The full one-command flow. @returns a structured report of each step.
 */
export async function oneClickInstall({ model = DEFAULT_MODEL, pull = true, onLog = () => {} } = {}) {
  const steps = {};
  steps.install = await installRuntime({ onLog });
  if (!steps.install.ok) return { ok: false, steps, error: steps.install.error };
  steps.daemon = await ensureDaemon({ onLog });
  if (!steps.daemon.ok) return { ok: false, steps, error: steps.daemon.error };
  if (pull) {
    steps.pull = await pullModel(model, { onLog });
    // A failed pull is non-fatal — the runtime is usable, model can be pulled later.
  }
  steps.models = await localModels();
  return { ok: true, steps, models: steps.models };
}

export default { isOllamaInstalled, isDaemonUp, installRuntime, ensureDaemon, pullModel, localModels, oneClickInstall };
