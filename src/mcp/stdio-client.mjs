/**
 * MCP stdio client transport — spawns a server process and speaks JSON-RPC
 * over stdin/stdout. Counterpart to stdio.mjs (our stdio SERVER).
 *
 * Framing: writes newline-delimited JSON (the MCP spec stdio framing);
 * reads BOTH newline-delimited and Content-Length (LSP-style) frames so it
 * interops with spec servers and with our own stdio server, which replies
 * with Content-Length.
 *
 * Server config: { name, command, args?, env?, cwd? }
 */
import { spawn } from "node:child_process";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export function createStdioTransport(server = {}, opts = {}) {
  const timeoutMs = Number(opts.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS);
  let child = null;
  let buf = "";
  let nextId = 1;
  let closed = false;
  /** @type {Map<number, {resolve, reject, timer}>} */
  const pending = new Map();

  function failAll(err) {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
  }

  function handleFrame(raw) {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return; // ignore non-JSON noise (some servers log to stdout)
    }
    if (body?.id == null) return; // notification from server — ignored
    const p = pending.get(body.id);
    if (!p) return;
    pending.delete(body.id);
    clearTimeout(p.timer);
    if (body.error) {
      p.reject(new Error(body.error.message || JSON.stringify(body.error)));
    } else {
      p.resolve(body.result);
    }
  }

  function onData(chunk) {
    buf += chunk;
    while (true) {
      if (buf.startsWith("Content-Length:")) {
        const m = buf.match(/^Content-Length:\s*(\d+)\r?\n\r?\n/);
        if (!m) break;
        const len = Number(m[1]);
        const headerLen = m[0].length;
        if (Buffer.byteLength(buf, "utf8") < headerLen + len) break;
        const bodyBuf = Buffer.from(buf, "utf8");
        const body = bodyBuf.subarray(headerLen, headerLen + len).toString("utf8");
        buf = bodyBuf.subarray(headerLen + len).toString("utf8");
        handleFrame(body);
        continue;
      }
      const nl = buf.indexOf("\n");
      if (nl < 0) break;
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) handleFrame(line);
    }
  }

  function ensureStarted() {
    if (child || closed) return;
    child = spawn(server.command, server.args || [], {
      cwd: server.cwd || process.cwd(),
      env: { ...process.env, ...(server.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", onData);
    child.stderr.on("data", () => {}); // server logs — not part of protocol
    child.on("error", (err) => failAll(err));
    child.on("exit", (code) => {
      const err = new Error(
        `MCP server "${server.name}" exited (code ${code ?? "signal"})`
      );
      child = null;
      if (!closed) failAll(err);
    });
  }

  /**
   * @param {string} method
   * @param {object} [params]
   * @returns {Promise<any>}
   */
  function request(method, params = {}) {
    ensureStarted();
    if (!child) return Promise.reject(new Error("transport closed"));
    const id = nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${method} timed out after ${timeoutMs}ms (${server.name})`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(payload + "\n", (err) => {
        if (err) {
          pending.delete(id);
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  /** Fire-and-forget notification (no id, no response expected). */
  function notify(method, params = {}) {
    ensureStarted();
    if (!child) return;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  function close() {
    closed = true;
    failAll(new Error("transport closed"));
    if (child) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* */
      }
      child = null;
    }
  }

  return { request, notify, close, kind: "stdio" };
}

export default { createStdioTransport };
