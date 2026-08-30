/**
 * python_session — persistent, stateful Python execution for the agent loop
 * and (opt-in) swarm sub-agents, backed by the Jupyter kernel POOL
 * (src/swarm/runtime/python/kernel_pool_server.py, built on the
 * operator-delivered JupyterKernel class).
 *
 * WHY a kernel, not xclaw_bash `python3 -c`: xclaw_bash is stateless — each
 * call is a fresh process, so a dataframe loaded in one call is gone by the
 * next. A Jupyter kernel keeps variables/imports/loaded data alive across
 * calls within a session, so a data-analysis pass loads once then iterates.
 * Each session id maps to its own isolated kernel (pool: LRU-capped, idle-
 * reaped, loopback-only).
 *
 * RISK: arbitrary Python is exec-family. `python_session` is classified
 * "exec" by the risk assessor (EXEC_RE now matches `python`), so it tiers
 * RISKY — it pends for the main agent's human approval and is DENIED to swarm
 * sub-agents unless the operator both allow-lists it and raises
 * autoApproveMaxTier. Never auto-runs.
 *
 * AVAILABILITY: the tool advertises itself ONLY when the kernel venv exists
 * (or cfg.tools.python.enabled === true) — hosts without the venv don't see a
 * tool they can't use. The pool server is lazy-started on first execute().
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = join(here, "..", "swarm", "runtime", "python");
const VENV_PY = process.env.XCLAW_KERNEL_PY || "/opt/xclaw-kernel/venv/bin/python";
const POOL_PORT = Number(process.env.XCLAW_KERNEL_POOL_PORT || 18799);
const POOL_URL = `http://127.0.0.1:${POOL_PORT}`;

function textResult(text, extra = {}) {
  return { content: [{ type: "text", text: String(text ?? "") }], ...extra };
}
function errorResult(msg) {
  return { isError: true, content: [{ type: "text", text: String(msg) }] };
}

let starting = null;

async function poolHealthy() {
  try {
    const r = await fetch(`${POOL_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Lazy-start the pool server; returns {ok} or {ok:false,error}. */
async function ensurePool() {
  if (await poolHealthy()) return { ok: true };
  if (!existsSync(VENV_PY)) {
    return {
      ok: false,
      error:
        `python kernel pool unavailable: ${VENV_PY} missing. Install once:\n` +
        "  python3 -m venv /opt/xclaw-kernel/venv &&\n" +
        "  /opt/xclaw-kernel/venv/bin/pip install fastapi uvicorn jupyter_client ipykernel pydantic psutil matplotlib numpy pandas",
    };
  }
  if (!starting) {
    starting = (async () => {
      const child = spawn(
        VENV_PY,
        [join(RUNTIME_DIR, "kernel_pool_server.py"), "--port", String(POOL_PORT)],
        { cwd: RUNTIME_DIR, detached: true, stdio: "ignore" }
      );
      child.unref();
      if (child.pid) {
        import("../computer/modules/bash-tool.mjs")
          .then((m) =>
            m.registerBackgroundPid(child.pid, { kind: "python-kernel-pool" })
          )
          .catch(() => {});
      }
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await poolHealthy()) return { ok: true };
      }
      return { ok: false, error: "kernel pool did not become healthy within 15s" };
    })();
  }
  const res = await starting;
  starting = null;
  return res;
}

// Strip ANSI so the model reads clean tracebacks.
// eslint-disable-next-line no-control-regex
const stripAnsi = (s) => (s ? String(s).replace(/\x1b\[[0-9;]*m/g, "") : "");

/** Persist base64 PNGs the kernel produced into the workspace; return paths. */
export async function saveKernelImages(images, workingDir, session) {
  const paths = [];
  for (let i = 0; i < images.length; i++) {
    try {
      const buf = Buffer.from(images[i], "base64");
      if (buf.length < 32) continue;
      const name = `py_${session}_${Date.now()}_${i}.png`;
      const p = join(workingDir, name);
      await fs.writeFile(p, buf);
      const written = await fs.readFile(p);
      if (written.length !== buf.length) continue;
      paths.push(p);
    } catch {
      /* skip an unwritable image, keep the rest */
    }
  }
  return paths;
}

export function createPythonSessionTool({ workingDir, cfg } = {}) {
  const wd = workingDir || process.cwd();
  return {
    name: "python_session",
    description:
      "Execute Python in a PERSISTENT stateful kernel — variables, imports, and loaded data survive across calls within a session (unlike xclaw_bash, which is stateless). Use for iterative data analysis: load a dataframe once, then explore it over several calls. pandas/numpy/matplotlib are available. For plots, start with `%matplotlib inline` — figures are then captured, saved to the workspace, and their file paths returned. Same `session` id shares state; different ids are isolated.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Python source to execute in the kernel" },
        session: {
          type: "string",
          description: "Session id — same id shares kernel state (default: 'default')",
        },
        timeout: { type: "number", description: "Seconds, 1–600 (default 60)" },
        reset: {
          type: "boolean",
          description: "Restart this session's kernel (clear all state) BEFORE running the code",
        },
      },
      required: ["code"],
    },
    async execute(args = {}) {
      const src = String(args.code || "").trim();
      if (!src) return errorResult("code required");
      const session = String(args.session || "default").slice(0, 64) || "default";
      const timeout = Math.min(Math.max(Number(args.timeout) || 60, 1), 600);

      const up = await ensurePool();
      if (!up.ok) return errorResult(up.error);

      try {
        if (args.reset === true) {
          let rr;
          try {
            rr = await fetch(`${POOL_URL}/sessions/${encodeURIComponent(session)}/reset`, {
              method: "POST",
              signal: AbortSignal.timeout(30_000),
            });
          } catch (e) {
            return errorResult(`kernel reset failed: ${e.message}`);
          }
          if (!rr.ok && rr.status !== 404) {
            return errorResult(`kernel reset HTTP ${rr.status}`);
          }
        }

        const r = await fetch(`${POOL_URL}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: src, session, timeout }),
          signal: AbortSignal.timeout((timeout + 15) * 1000),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return errorResult(j.detail || `kernel pool HTTP ${r.status}`);

        const output = stripAnsi(j.output).trimEnd();
        const err = stripAnsi(j.error).trimEnd();
        const imgPaths = Array.isArray(j.images) && j.images.length
          ? await saveKernelImages(j.images, wd, session)
          : [];
        if (Array.isArray(j.images) && j.images.length && imgPaths.length === 0) {
          return errorResult("kernel returned images but none could be saved to disk");
        }

        const parts = [];
        if (output) parts.push(output);
        if (imgPaths.length) parts.push(`[${imgPaths.length} image(s) saved: ${imgPaths.join(", ")}]`);
        if (!j.success && err) parts.push(err);
        if (!parts.length) parts.push(j.success ? "(no output)" : "(execution failed)");

        const text = parts.join("\n");
        const meta = { session, stateful: true, images: imgPaths };
        return j.success ? textResult(text, { metadata: meta }) : errorResult(text);
      } catch (e) {
        if (e?.name === "TimeoutError" || /timed out|aborted/i.test(e?.message || "")) {
          // interrupt the runaway cell so the kernel is reusable next call
          await fetch(`${POOL_URL}/sessions/${encodeURIComponent(session)}/interrupt`, {
            method: "POST",
            signal: AbortSignal.timeout(10_000),
          }).catch(() => {});
          return errorResult(`python_session: execution exceeded ${timeout}s (kernel interrupted)`);
        }
        return errorResult(`python_session: ${e.message}`);
      }
    },
  };
}

/**
 * Advertise python_session only when the kernel is actually installable/usable
 * on this host: venv present, or explicitly enabled by config for a host that
 * will install it. Keeps the model's tool surface honest.
 */
export function createPythonTools({ workingDir, cfg } = {}) {
  const enabled = cfg?.tools?.python?.enabled === true || existsSync(VENV_PY);
  if (!enabled) return [];
  return [createPythonSessionTool({ workingDir, cfg })];
}

export function pythonToolsAsOpenAI(tools) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters || { type: "object", properties: {} },
    },
  }));
}
