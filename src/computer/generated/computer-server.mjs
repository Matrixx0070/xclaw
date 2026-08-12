/* Strategy C3 GENERATED — do not hand-edit. Full CDP remains xclaw-server.mjs */

// src/computer/thin-server.mjs
import http2 from "node:http";
import crypto2 from "node:crypto";

// src/computer/modules/bash-tool.mjs
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
var DEFAULT_TIMEOUT_SECONDS = 30;
async function runBash(input = {}, ctx = {}) {
  const command = String(input.command || "");
  if (!command.trim()) {
    return { ok: false, stdout: "", stderr: "command is required", exitCode: 1 };
  }
  const timeoutSec = Number(input.timeout ?? DEFAULT_TIMEOUT_SECONDS);
  const timeoutMs = Math.min(12e4, Math.max(0, timeoutSec * 1e3));
  const cwd = ctx.cwd || process.cwd();
  const background = Boolean(input.background);
  if (background) {
    const logDir = path.join(os.tmpdir(), "xclaw-bash-bg");
    await fs.mkdir(logDir, { recursive: true });
    const logFile = path.join(logDir, `${crypto.randomBytes(6).toString("hex")}.log`);
    const logFd = await fs.open(logFile, "w");
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      detached: true,
      stdio: ["ignore", logFd.fd, logFd.fd],
      env: process.env
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
      interrupted: false
    };
  }
  return new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      env: process.env,
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
        interrupted
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
      command: { type: "string" },
      timeout: { type: "number", description: "Seconds (max 120)" },
      background: { type: "boolean" }
    },
    required: ["command"]
  },
  isReadOnly: () => false,
  async call(input, context = {}) {
    const data = await runBash(input, {
      cwd: context.cwd || context.workingDir || process.cwd(),
      signal: context.signal || context.abortController?.signal
    });
    return { data };
  }
};

// src/computer/modules/file-tools.mjs
import fs2 from "node:fs/promises";
import path2 from "node:path";
function resolveSafe(cwd, filePath) {
  const root2 = path2.resolve(cwd || process.cwd());
  const target = path2.resolve(root2, filePath);
  if (!target.startsWith(root2 + path2.sep) && target !== root2) {
    const err = new Error(`Path escapes workspace: ${filePath}`);
    err.code = "E_SANDBOX";
    throw err;
  }
  return target;
}
async function fileRead(input = {}, ctx = {}) {
  const cwd = ctx.cwd || process.cwd();
  const target = resolveSafe(cwd, input.path || input.file_path);
  const content = await fs2.readFile(target, "utf8");
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
  await fs2.mkdir(path2.dirname(target), { recursive: true });
  const content = input.content ?? "";
  await fs2.writeFile(target, content, "utf8");
  return {
    ok: true,
    path: target,
    bytes: Buffer.byteLength(String(content), "utf8")
  };
}
async function fileEdit(input = {}, ctx = {}) {
  const cwd = ctx.cwd || process.cwd();
  const target = resolveSafe(cwd, input.path || input.file_path);
  let text = await fs2.readFile(target, "utf8");
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
  await fs2.writeFile(target, text, "utf8");
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
function fetchUrl(urlStr, timeoutMs = 15e3) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL2(urlStr);
    } catch (e) {
      reject(e);
      return;
    }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      urlStr,
      {
        method: "GET",
        headers: {
          "user-agent": "XClawNativeBrowser/3.70 (+https://xclaw; lightweight-fetch)",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        },
        timeout: timeoutMs
      },
      (res) => {
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
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8")
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
function htmlToText(html) {
  return String(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 12e3);
}
async function runBrowserTab(input = {}) {
  if (input.jsCode) {
    return {
      ok: false,
      error: "jsCode requires CDP/BrowserService. Native lightweight browser_tab only supports url load/fetch. Set computer to full bundle or wire browser-service.",
      tabId: input.tabId || null
    };
  }
  if (input.screenshot) {
    return {
      ok: false,
      error: "screenshot requires CDP/BrowserService. Native lightweight browser_tab does not capture images yet.",
      tabId: input.tabId || null
    };
  }
  let tab = input.tabId ? tabs.get(input.tabId) : null;
  if (input.tabId && !tab) {
    return {
      ok: false,
      error: `Unknown tabId: ${input.tabId}`,
      tabId: input.tabId
    };
  }
  if (input.url) {
    const res = await fetchUrl(input.url);
    const title = extractTitle(res.body);
    const text = htmlToText(res.body);
    const id = tab?.id || nextId();
    tab = {
      id,
      url: input.url,
      title,
      text,
      status: res.status,
      at: (/* @__PURE__ */ new Date()).toISOString()
    };
    tabs.set(id, tab);
    return {
      ok: true,
      tabId: id,
      url: tab.url,
      title: tab.title,
      status: tab.status,
      textPreview: tab.text.slice(0, 4e3),
      engine: "native-fetch",
      networkSummaries: input.includeNetwork ? [
        {
          requestId: "nav1",
          method: "GET",
          url: input.url,
          status: res.status
        }
      ] : void 0
    };
  }
  if (tab) {
    return {
      ok: true,
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      textPreview: tab.text.slice(0, 4e3),
      engine: "native-fetch"
    };
  }
  return {
    ok: false,
    error: "Provide url to open a tab (native lightweight mode)"
  };
}
var BrowserTabTool = {
  name: "xclaw_browser_tab",
  description: "Loads a URL into a lightweight native tab (fetch + text extract). Full JS/screenshot needs BrowserService/CDP.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      tabId: { type: "string" },
      jsCode: { type: "string" },
      includeNetwork: { type: "boolean" },
      screenshot: { type: "string", description: "mobile|desktop|both (requires CDP)" }
    }
  },
  isReadOnly: () => false,
  async call(input, context = {}) {
    return { data: await runBrowserTab(input, context) };
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
import fs3 from "node:fs/promises";
import path3 from "node:path";
import { fileURLToPath } from "node:url";
var root = path3.resolve(path3.dirname(fileURLToPath(import.meta.url)), "../..");
async function loadModuleMap() {
  const p = path3.join(root, "src/computer/MODULE_MAP.json");
  const raw = await fs3.readFile(p, "utf8");
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
        const id = `sess_${crypto2.randomBytes(8).toString("hex")}`;
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
