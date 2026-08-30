/**
 * HTTP client for the XClaw Computer server (tool sandbox).
 * Transient HTTP/network errors retry with jittered backoff.
 */
import http from "node:http";
import {
  withBackoff,
  backoffOptsFromConfig,
  isTransientError,
} from "../utils/backoff.mjs";
import { computerAuthHeaders } from "../computer/auth.mjs";
import { computerBaseUrl } from "../computer/manager.mjs";

function requestOnce(baseUrl, method, path, body, authHeaders = {}) {
  const u = new URL(path, baseUrl);
  const payload = body != null ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...authHeaders,
        },
        timeout: 120_000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = data;
          try {
            parsed = JSON.parse(data);
          } catch {
            /* raw */
          }
          if (res.statusCode >= 400) {
            const err = new Error(
              typeof parsed === "object" && parsed.error
                ? parsed.error
                : `HTTP ${res.statusCode}: ${data.slice(0, 200)}`
            );
            err.status = res.statusCode;
            err.body = parsed;
            err.headers = res.headers;
            const ra = res.headers?.["retry-after"];
            if (ra != null) err.retryAfter = ra;
            reject(err);
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on("error", (err) => {
      const e = err || new Error("computer request failed");
      if (e.code === "ECONNREFUSED") {
        e.message = `Computer unreachable (${e.code}) at ${u.protocol}//${u.hostname}:${u.port}. Run: xclaw gateway`;
      }
      reject(e);
    });
    req.on("timeout", () => {
      req.destroy();
      const err = new Error(`computer request timeout after 120s (${u.hostname}:${u.port})`);
      err.code = "ETIMEDOUT";
      reject(err);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * @param {object} cfg
 * @param {object} [cfg.computer]
 * @param {object} [cfg.retry]
 */

/**
 * Clamp model-supplied tool args so strict computer schemas (bundle Zod max
 * timeout 120 seconds) do not reject millisecond values.
 * @param {string} name
 * @param {object} args
 */
export function sanitizeToolArgs(name, args = {}) {
  if (!args || typeof args !== "object") return args || {};
  const n = String(name || "");
  if (n === "xclaw_bash" || n === "bash" || n.endsWith("_bash")) {
    if ("timeout" in args && args.timeout != null && args.timeout !== "") {
      let sec = Number(args.timeout);
      if (!Number.isFinite(sec) || sec < 0) sec = 30;
      if (sec > 1000) sec = sec / 1000; // ms → s
      if (sec > 120) sec = 120;
      args = { ...args, timeout: sec };
    }
  }
  return args;
}

/** @type {Map<string, { sessionId: string, workingDir: string, at: number }>} */
const sessionReusePool = new Map();
/** @type {Map<string, { tools: any[], at: number }>} */
const toolsListCache = new Map();


function sessionTtlMs(cfg = {}) {
  const raw =
    process.env.XCLAW_COMPUTER_SESSION_TTL_MS ??
    cfg.computer?.sessionTtlMs ??
    30 * 60 * 1000; // 30m default
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 30 * 60 * 1000;
  return n;
}

/**
 * Drop stale pool entries (and tools cache). Optional HTTP destroy when request fn provided.
 * @param {{ ttlMs?: number, request?: Function }} [opts]
 */
export function pruneExpiredSessionPool(opts = {}) {
  const ttl = opts.ttlMs ?? sessionTtlMs();
  const now = Date.now();
  const expired = [];
  for (const [k, v] of sessionReusePool.entries()) {
    if (!v?.at || now - v.at >= ttl) {
      expired.push({ key: k, sessionId: v?.sessionId });
      sessionReusePool.delete(k);
      if (v?.sessionId) {
        toolsListCache.delete(v.sessionId);
        if (typeof opts.request === "function") {
          opts.request("POST", "/xclaw/sessions/destroy", { sessionId: v.sessionId }).catch(() => {});
        }
      }
    }
  }
  // Also expire orphan tools caches older than ttl
  for (const [sid, meta] of toolsListCache.entries()) {
    if (!meta?.at || now - meta.at >= ttl) toolsListCache.delete(sid);
  }
  return { expired: expired.length, sessions: sessionReusePool.size, toolsLists: toolsListCache.size };
}

function reuseEnabled(cfg) {
  if (process.env.XCLAW_COMPUTER_REUSE_SESSION === "0") return false;
  if (process.env.XCLAW_COMPUTER_REUSE_SESSION === "1") return true;
  if (cfg.computer?.reuseSession === false) return false;
  if (cfg.computer?.reuseSession === true) return true;
  // Default on for a local engine (cheap sessions still benefit multi-run);
  // off for an explicit remote. This used to be keyed to the engine NAMES
  // "native"/"thin"/unset, which inverted after ADR 0006: the canonical name
  // is now "bundle", so naming the engine you actually run silently turned
  // reuse off, while naming a retired one turned it on. remoteUrl is the
  // condition the comment always meant.
  return !cfg.computer?.remoteUrl;
}

function poolKey(baseUrl, workingDir) {
  return `${baseUrl}::${workingDir}`;
}

export function createComputerClient(cfg) {
  const baseUrl =
    cfg.computer?.remoteUrl ||
    computerBaseUrl(cfg) ||
    `http://${cfg.computer?.host || "127.0.0.1"}:${cfg.computer?.port || 4243}`;
  const backoffOpts = backoffOptsFromConfig(cfg);
  const canReuse = reuseEnabled(cfg);

  function request(method, path, body, signal) {
    const authHeaders = computerAuthHeaders(cfg, body);
    return withBackoff(() => requestOnce(baseUrl, method, path, body, authHeaders), {
      ...backoffOpts,
      signal,
      shouldRetry: isTransientError,
      onRetry: async (info) => {
        if (cfg.retry?.log !== false) {
          console.warn(
            `[xclaw] computer retry ${info.attempt}/${info.retries} after ${info.delayMs}ms: ${info.error?.message || info.error}`
          );
        }
        const down =
          info.error?.code === "ECONNREFUSED" ||
          info.error?.code === "ETIMEDOUT" ||
          /Computer unreachable/i.test(String(info.error?.message || ""));
        if (down && !cfg.computer?.remoteUrl) {
          try {
            const { ensureComputer } = await import("../computer/ensure.mjs");
            await ensureComputer(cfg, { log: false, attempts: 1 });
          } catch {
            /* next attempt still runs */
          }
        }
      },
    });
  }

  return {
    baseUrl,

    async health() {
      return request("GET", "/health");
    },

    async createSession(workingDir = process.cwd()) {
      const wd = String(workingDir || process.cwd());
      if (canReuse) {
        pruneExpiredSessionPool({ ttlMs: sessionTtlMs(cfg), request });
        const key = poolKey(baseUrl, wd);
        const hit = sessionReusePool.get(key);
        if (hit?.sessionId) {
          // Always probe. A warm tools cache used to skip this, so a
          // recycled sessionId after computer restart looked live until
          // the first real tool call failed.
          try {
            const r = await request("POST", `/xclaw/sessions/${hit.sessionId}/tools/list`, {
              method: "tools/list",
            });
            toolsListCache.set(hit.sessionId, {
              tools: r.tools || [],
              at: Date.now(),
            });
            hit.at = Date.now();
            return hit.sessionId;
          } catch {
            sessionReusePool.delete(key);
            toolsListCache.delete(hit.sessionId);
          }
        }
      }
      const r = await request("POST", "/xclaw/sessions/create", {
        workingDir: wd,
      });
      if (canReuse && r.sessionId) {
        sessionReusePool.set(poolKey(baseUrl, wd), {
          sessionId: r.sessionId,
          workingDir: wd,
          at: Date.now(),
        });
      }
      return r.sessionId;
    },

    async destroySession(sessionId) {
      // Soft-destroy when reusing: keep session for next runAgent in-process
      if (canReuse) {
        for (const [k, v] of sessionReusePool.entries()) {
          if (v.sessionId === sessionId) {
            // leave pooled; agent loop still "destroys" but we no-op HTTP
            if (process.env.XCLAW_COMPUTER_REUSE_HARD_DESTROY === "1") {
              sessionReusePool.delete(k);
              toolsListCache.delete(sessionId);
              return request("POST", "/xclaw/sessions/destroy", { sessionId });
            }
            return { ok: true, reused: true };
          }
        }
      }
      return request("POST", "/xclaw/sessions/destroy", { sessionId });
    },

    async listTools(sessionId) {
      const sid = String(sessionId || "");
      // Always fetch. A warm toolsListCache used to skip HTTP, so after a
      // computer restart listTools still advertised tools for a dead
      // session. The cache remains a snapshot for stats/reuse probes.
      try {
        const r = await request(
          "POST",
          `/xclaw/sessions/${sid}/tools/list`,
          { method: "tools/list" }
        );
        const tools = r.tools || [];
        toolsListCache.set(sid, { tools, at: Date.now() });
        return tools;
      } catch (e) {
        toolsListCache.delete(sid);
        throw e;
      }
    },

    async callTool(sessionId, name, args) {
      // Tool *logic* errors are returned as HTTP 200 + isError payload.
      // Only transport-level failures are retried by withBackoff.
      return request("POST", `/xclaw/sessions/${sessionId}/tools/call`, {
        method: "tools/call",
        params: { name, arguments: sanitizeToolArgs(name, args || {}) },
      });
    },
  };
}

/**
 * Convert Computer tool schemas → OpenAI function tools.
 */
export function toOpenAITools(computerTools) {
  // Sort by name so tool schema prefix is byte-stable across sessions
  return [...computerTools]
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description || t.name,
        parameters: t.inputSchema || { type: "object", properties: {} },
      },
    }));
}

/**
 * Flatten tool result content for the model.
 */
export function formatToolResult(result) {
  if (!result) return "(no result)";
  if (result.isError) {
    const texts = (result.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text);
    return texts.join("\n") || JSON.stringify(result);
  }
  const texts = (result.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text);
  if (texts.length) return texts.join("\n");
  if (result.metadata) return JSON.stringify(result.metadata, null, 2);
  return JSON.stringify(result);
}


/** Test/helper: drop reuse pool */
export function clearComputerSessionPool() {
  sessionReusePool.clear();
  toolsListCache.clear();
}

/** @returns {{ sessions: number, toolsLists: number }} */
export function computerClientCacheStats() {
  return { sessions: sessionReusePool.size, toolsLists: toolsListCache.size };
}
