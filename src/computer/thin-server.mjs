/**
 * Thin computer HTTP server — transitional lab/default until Strategy C4.
 * Full runtime target remains src/computer/xclaw-server.mjs (built from modules; do not hand-edit).
 *
 * Compatible with createComputerClient session API:
 *   GET  /health
 *   POST /xclaw/sessions/create
 *   POST /xclaw/sessions/destroy
 *   POST /xclaw/sessions/:id/tools/list
 *   POST /xclaw/sessions/:id/tools/call
 *   GET  /tools
 *   POST /call
 *   GET  /extraction
 *
 * Enable bundle instead: computer.engine = "bundle" or XCLAW_COMPUTER_NATIVE=0
 */

import http from "node:http";
import crypto from "node:crypto";
import { listNativeTools, executeNativeTool, NATIVE_TOOLS } from "./native-tools.mjs";
import { BrowserTabTool, runBrowserTab } from "./modules/browser-tab-tool.mjs";
import { getExtractionStatus } from "./extraction-status.mjs";

const ALL = [...NATIVE_TOOLS];
// BrowserTabTool is already in NATIVE_TOOLS after earlier wire-up; avoid dup in list

/** @type {Map<string, { id: string, workingDir: string, createdAt: string }>} */
const sessions = new Map();

function toolDescriptors() {
  const seen = new Set();
  const tools = [];
  for (const t of listNativeTools()) {
    if (!t?.name || seen.has(t.name)) continue;
    seen.add(t.name);
    const desc =
      typeof t.description === "function" ? t.description() : t.description;
    tools.push({
      name: t.name,
      description: desc || t.name,
      inputSchema:
        t.parameters || t.inputSchema || { type: "object", properties: {} },
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
  const text =
    result == null
      ? "(no result)"
      : typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);
  const isError = result && result.ok === false;
  return {
    content: [{ type: "text", text }],
    isError: Boolean(isError),
    metadata: { name, engine: "thin-native" },
  };
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}

export function createThinComputerServer(opts = {}) {
  const host = opts.host || process.env.XCLAW_COMPUTER_HOST || "127.0.0.1";
  const port = Number(opts.port || process.env.XCLAW_COMPUTER_PORT || 4243);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    const send = (code, body) => {
      const raw = typeof body === "string" ? body : JSON.stringify(body);
      res.writeHead(code, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(raw),
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
          tools: toolDescriptors().map((t) => t.name),
        });
      }

      if (req.method === "GET" && url.pathname === "/tools") {
        return send(200, { tools: toolDescriptors() });
      }

      if (req.method === "GET" && url.pathname === "/extraction") {
        return send(200, await getExtractionStatus());
      }

      // --- Session API (computer-client compatible) ---
      if (req.method === "POST" && url.pathname === "/xclaw/sessions/create") {
        const parsed = await readJson(req);
        const id = `sess_${crypto.randomBytes(8).toString("hex")}`;
        const workingDir = parsed.workingDir || process.cwd();
        sessions.set(id, {
          id,
          workingDir,
          createdAt: new Date().toISOString(),
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
          // Auto-create soft session so list always works
          sessions.set(id, {
            id,
            workingDir: process.cwd(),
            createdAt: new Date().toISOString(),
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
          workingDir: process.cwd(),
        };
        if (!sessions.has(id)) sessions.set(id, { ...sess, createdAt: new Date().toISOString() });
        const parsed = await readJson(req);
        const name =
          parsed.params?.name || parsed.name || parsed.tool;
        const args =
          parsed.params?.arguments ||
          parsed.arguments ||
          parsed.args ||
          {};
        if (!name) return send(400, { error: "tool name required" });
        try {
          const result = await dispatch(name, args, {
            cwd: sess.workingDir,
          });
          return send(200, formatCallResult(name, result));
        } catch (err) {
          return send(200, {
            content: [{ type: "text", text: String(err.message || err) }],
            isError: true,
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
          "/xclaw/sessions/:id/tools/call",
        ],
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
    },
  };
}

const isMain = (() => {
  const a = process.argv[1] || "";
  return (
    a.endsWith("thin-server.mjs") ||
    a.includes("thin-server") ||
    a.endsWith("computer-server.mjs") ||
    a.includes("generated/computer-server")
  );
})();

if (isMain) {
  const svc = createThinComputerServer();
  await svc.listen();
}

export default createThinComputerServer;
