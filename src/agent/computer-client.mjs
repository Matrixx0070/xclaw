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
export function createComputerClient(cfg) {
  const baseUrl =
    cfg.computer?.remoteUrl ||
    computerBaseUrl(cfg) ||
    `http://${cfg.computer?.host || "127.0.0.1"}:${cfg.computer?.port || 4243}`;
  const backoffOpts = backoffOptsFromConfig(cfg);

  function request(method, path, body, signal) {
    const authHeaders = computerAuthHeaders(cfg, body);
    return withBackoff(() => requestOnce(baseUrl, method, path, body, authHeaders), {
      ...backoffOpts,
      signal,
      shouldRetry: isTransientError,
      onRetry: (info) => {
        if (cfg.retry?.log !== false) {
          console.warn(
            `[xclaw] computer retry ${info.attempt}/${info.retries} after ${info.delayMs}ms: ${info.error?.message || info.error}`
          );
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
      const r = await request("POST", "/xclaw/sessions/create", {
        workingDir,
      });
      return r.sessionId;
    },

    async destroySession(sessionId) {
      return request("POST", "/xclaw/sessions/destroy", { sessionId });
    },

    async listTools(sessionId) {
      const r = await request(
        "POST",
        `/xclaw/sessions/${sessionId}/tools/list`,
        { method: "tools/list" }
      );
      return r.tools || [];
    },

    async callTool(sessionId, name, args) {
      // Tool *logic* errors are returned as HTTP 200 + isError payload.
      // Only transport-level failures are retried by withBackoff.
      return request("POST", `/xclaw/sessions/${sessionId}/tools/call`, {
        method: "tools/call",
        params: { name, arguments: args || {} },
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
