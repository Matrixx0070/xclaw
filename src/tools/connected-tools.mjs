/**
 * Connected tools — catalog search + call (voice, github, generic HTTP).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { listCatalogTools, resolveToken, CONNECTED_CATALOG } from "../connected/catalog.mjs";

function textResult(text, extra = {}) {
  return { content: [{ type: "text", text: String(text ?? "") }], ...extra };
}
function errorResult(msg) {
  return { isError: true, content: [{ type: "text", text: String(msg) }] };
}

async function neuralTts(text, out, voice) {
  const key =
    process.env.TTS_API_KEY || process.env.OPENAI_API_KEY || process.env.XAI_API_KEY;
  if (!key) return null;
  const base =
    process.env.TTS_BASE_URL ||
    (process.env.OPENAI_API_KEY ? "https://api.openai.com/v1" : "") ||
    "https://api.openai.com/v1";
  // OpenAI-compatible audio/speech
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.TTS_MODEL || "gpt-4o-mini-tts",
        input: text,
        voice: voice || process.env.TTS_VOICE || "alloy",
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) return null;
    await fs.mkdir(path.dirname(out), { recursive: true });
    const dest = out.endsWith(".mp3") || out.endsWith(".wav") ? out : out + ".mp3";
    await fs.writeFile(dest, buf);
    const written = await fs.readFile(dest);
    if (written.length !== buf.length) return null;
    return dest;
  } catch {
    return null;
  }
}

async function localTts(text, out) {
  await fs.mkdir(path.dirname(out), { recursive: true });
  const tryCmd = (cmd, args) =>
    new Promise((resolve) => {
      const c = spawn(cmd, args);
      c.on("close", (code) => resolve(code === 0));
      c.on("error", () => resolve(false));
    });
  const landed = async (file) => {
    try {
      const st = await fs.stat(file);
      return st.size > 0 ? file : null;
    } catch {
      return null;
    }
  };
  if (await tryCmd("espeak-ng", ["-w", out, text])) {
    const hit = await landed(out);
    if (hit) return hit;
  }
  if (await tryCmd("espeak", ["-w", out, text])) {
    const hit = await landed(out);
    if (hit) return hit;
  }
  // piper if present: echo text | piper --model x --output_file out
  if (await tryCmd("bash", ["-lc", `command -v piper >/dev/null && echo ${JSON.stringify(text)} | piper -m en_US-lessac-medium -f ${JSON.stringify(out)}`])) {
    const hit = await landed(out);
    if (hit) return hit;
  }
  return null;
}

export function createSearchConnectedToolsTool(ctx = {}) {
  return {
    name: "search_connected_tools",
    description: "Search connected/MCP tools (Voice, GitHub, HTTP). Describe the ACTION.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      required: ["query"],
    },
    async execute(args = {}) {
      const q = String(args.query || "").toLowerCase();
      const limit = Math.min(Number(args.limit) || 10, 30);
      const all = listCatalogTools();
      for (const t of ctx.cfg?.mcp?.tools || []) {
        all.push({ name: t.name, description: t.description || "", input_schema: t.inputSchema });
      }
      const scored = all
        .map((t) => {
          const hay = `${t.name} ${t.description} ${t.app_id || ""}`.toLowerCase();
          let score = 0;
          for (const w of q.split(/\s+/)) if (w && hay.includes(w)) score++;
          return { ...t, score };
        })
        .filter((t) => !q || t.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      const list = scored.length ? scored : all.slice(0, limit);
      return textResult(JSON.stringify(list, null, 2), { metadata: { count: list.length } });
    },
  };
}

export function createCallConnectedToolTool(ctx = {}) {
  return {
    name: "call_connected_tool",
    description: "Execute a connected tool by name with JSON arguments.",
    parameters: {
      type: "object",
      properties: {
        tool_name: { type: "string" },
        arguments: { type: "object" },
      },
      required: ["tool_name"],
    },
    async execute(args = {}) {
      const name = String(args.tool_name || args.name || "").trim();
      const a = args.arguments || args.args || {};
      const cfg = ctx.cfg || {};
      const workingDir = ctx.workingDir || process.cwd();

      if (name === "voice_speak") {
        const text = String(a.text || "").trim();
        if (!text) return errorResult("text required");
        const out =
          a.out ||
          path.join(workingDir, "artifacts", "audio", `speak_${Date.now()}.wav`);
        const neural = await neuralTts(text, out, a.voice);
        if (neural) {
          return textResult(`Neural TTS written: ${neural}`, {
            metadata: { path: neural, engine: "api" },
          });
        }
        const local = await localTts(text, out.endsWith(".wav") ? out : out.replace(/\.\w+$/, "") + ".wav");
        if (local) {
          return textResult(`Local TTS written: ${local}`, {
            metadata: { path: local, engine: "espeak/piper" },
          });
        }
        const txt = out.replace(/\.\w+$/, "") + ".txt";
        await fs.mkdir(path.dirname(txt), { recursive: true });
        await fs.writeFile(txt, text);
        return errorResult(
          `No TTS engine available. Wrote transcript only: ${txt}`
        );
      }

      if (name === "github_request") {
        const tok = await resolveToken(cfg, "github");
        if (!tok?.accessToken) {
          return errorResult("GITHUB_TOKEN / GH_TOKEN not set and no stored github token");
        }
        const method = String(a.method || "GET").toUpperCase();
        let pth = String(a.path || "");
        if (!pth.startsWith("/")) pth = "/" + pth;
        const url = `https://api.github.com${pth}`;
        const doFetch = (token) =>
          fetch(url, {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "XClaw-Connected",
              ...(a.body ? { "Content-Type": "application/json" } : {}),
            },
            body: a.body ? JSON.stringify(a.body) : undefined,
            signal: AbortSignal.timeout(60_000),
          });
        let res = await doFetch(tok.accessToken);
        if (res.status === 401) {
          const again = await resolveToken(cfg, "github", { force: true });
          if (again?.accessToken && again.accessToken !== tok.accessToken) {
            res = await doFetch(again.accessToken);
          }
        }
        const text = await res.text();
        return textResult(
          `HTTP ${res.status}\n${text.slice(0, 50_000)}`,
          { metadata: { status: res.status, path: pth, refreshed: Boolean(tok.refreshed) } }
        );
      }

      if (name === "connected_http") {
        const appId = String(a.app_id || "");
        const tok = await resolveToken(cfg, appId);
        if (!tok?.accessToken) return errorResult(`No token for app ${appId}`);
        const method = String(a.method || "GET").toUpperCase();
        const url = String(a.url || "");
        if (!/^https?:\/\//i.test(url)) return errorResult("url must be http(s)");
        const res = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${tok.accessToken}`,
            ...(a.body ? { "Content-Type": "application/json" } : {}),
          },
          body: a.body ? JSON.stringify(a.body) : undefined,
          signal: AbortSignal.timeout(60_000),
        });
        const text = await res.text();
        return textResult(`HTTP ${res.status}\n${text.slice(0, 50_000)}`, {
          metadata: { status: res.status, appId },
        });
      }

      return errorResult(`Unknown connected tool: ${name}`);
    },
  };
}

export function createConnectedTools(ctx = {}) {
  return [createSearchConnectedToolsTool(ctx), createCallConnectedToolTool(ctx)];
}

export { CONNECTED_CATALOG };
