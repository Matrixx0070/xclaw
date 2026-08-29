/**
 * Phase 7.2 — light config validation for XClaw
 */
import { JITTER_STRATEGIES, resolveJitterStrategy } from "../utils/backoff.mjs";

/**
 * @param {object} cfg
 * @returns {{ ok: boolean, errors: string[], warnings: string[], cfg: object }}
 */
export function validateConfig(cfg) {
  const errors = [];
  const warnings = [];
  /** @type {Array<{ path?: string, code?: string, message: string, got?: any, hint?: string }>} */
  const details = [];
  if (!cfg || typeof cfg !== "object") {
    return {
      ok: false,
      errors: ["config must be an object"],
      warnings,
      details: [{ code: "CONFIG_NOT_OBJECT", message: "config must be an object" }],
      cfg,
    };
  }

  // Gateway bind
  if (cfg.gateway) {
    if (cfg.gateway.port != null && (!Number.isFinite(cfg.gateway.port) || cfg.gateway.port < 1 || cfg.gateway.port > 65535)) {
      errors.push("gateway.port must be 1–65535");
    }
    if (cfg.gateway.host === "0.0.0.0" || cfg.gateway.host === "::") {
      warnings.push(
        `gateway.host is ${cfg.gateway.host} (public bind). Prefer 127.0.0.1 unless intentional.`
      );
    }
  }

  // Computer
  if (cfg.computer?.port != null && (!Number.isFinite(cfg.computer.port) || cfg.computer.port < 1)) {
    errors.push("computer.port must be a positive port number");
  }

  // Agent
  if (cfg.agent?.maxTurns != null && cfg.agent.maxTurns < 1) {
    errors.push("agent.maxTurns must be >= 1");
  }

  // Stream resume buffers (detailed validation)
  if (cfg.stream) {
    const s = cfg.stream;
    /**
     * @param {string} path
     * @param {string} message
     * @param {{ code?: string, got?: any, hint?: string }} [extra]
     */
    const streamErr = (path, message, extra = {}) => {
      const detail = {
        path,
        code: extra.code || "STREAM_CONFIG_INVALID",
        message,
        got: extra.got,
        hint: extra.hint,
      };
      // String form for existing consumers; details[] for tooling
      errors.push(`${path}: ${message}`);
      details.push(detail);
    };

    if (s.capacity != null && (!Number.isFinite(Number(s.capacity)) || Number(s.capacity) < 1 || Number(s.capacity) > 100_000)) {
      streamErr("stream.capacity", "must be an integer 1–100000", {
        code: "STREAM_CAPACITY_RANGE",
        got: s.capacity,
        hint: "Ring buffer size per streamId. Example: 500",
      });
    }
    if (s.ttlMs != null && (!Number.isFinite(Number(s.ttlMs)) || Number(s.ttlMs) < 0)) {
      streamErr("stream.ttlMs", "must be >= 0 milliseconds", {
        code: "STREAM_TTL_INVALID",
        got: s.ttlMs,
        hint: "Time after markEnded before GC. 0 = expire immediately. Example: 300000 (5m)",
      });
    }
    if (s.ttlMs != null && Number(s.ttlMs) > 0 && Number(s.ttlMs) < 1000) {
      warnings.push(
        `stream.ttlMs is ${s.ttlMs}ms (<1s) — finished streams will vanish almost immediately; resume may fail`
      );
    }
    if (s.heartbeatMs != null && (!Number.isFinite(Number(s.heartbeatMs)) || Number(s.heartbeatMs) < 0)) {
      streamErr("stream.heartbeatMs", "must be >= 0 (0 disables heartbeat)", {
        code: "STREAM_HEARTBEAT_INVALID",
        got: s.heartbeatMs,
        hint: "SSE/NDJSON ping interval. Example: 15000",
      });
    }
    if (s.heartbeatMs != null && Number(s.heartbeatMs) > 0 && Number(s.heartbeatMs) < 1000) {
      warnings.push(
        `stream.heartbeatMs is ${s.heartbeatMs}ms — very chatty heartbeats may waste bandwidth`
      );
    }
    if (s.baseMs != null && (!Number.isFinite(Number(s.baseMs)) || Number(s.baseMs) < 0)) {
      streamErr("stream.baseMs", "must be >= 0", {
        code: "STREAM_BASE_MS_INVALID",
        got: s.baseMs,
        hint: "Backoff base for client resume. Example: 1000",
      });
    }
    if (s.maxMs != null && (!Number.isFinite(Number(s.maxMs)) || Number(s.maxMs) < 0)) {
      streamErr("stream.maxMs", "must be >= 0", {
        code: "STREAM_MAX_MS_INVALID",
        got: s.maxMs,
        hint: "Backoff cap for client resume. Example: 30000",
      });
    }
    if (
      s.maxMs != null &&
      s.baseMs != null &&
      Number.isFinite(Number(s.maxMs)) &&
      Number.isFinite(Number(s.baseMs)) &&
      Number(s.maxMs) < Number(s.baseMs)
    ) {
      streamErr("stream.maxMs", "must be >= stream.baseMs", {
        code: "STREAM_BACKOFF_RANGE",
        got: { baseMs: s.baseMs, maxMs: s.maxMs },
        hint: "Increase maxMs or lower baseMs",
      });
    }
    if (s.backoff != null) {
      const raw = String(s.backoff);
      const resolved = resolveJitterStrategy(raw);
      if (
        !["full", "equal", "decorrelated", "none"].includes(String(raw).toLowerCase()) &&
        resolved === "full" &&
        raw.toLowerCase() !== "full" &&
        !/full|equal|decorrelated|none|exp/.test(raw.toLowerCase())
      ) {
        warnings.push(
          `stream.backoff "${raw}" unknown; using "${resolved}". Allowed: full|equal|decorrelated|none`
        );
      }
      s.backoff = resolved;
    }
    if (s.maxResumeCycles != null && (!Number.isFinite(Number(s.maxResumeCycles)) || Number(s.maxResumeCycles) < 0)) {
      streamErr("stream.maxResumeCycles", "must be >= 0 (0 = unlimited in client)", {
        code: "STREAM_MAX_RESUME_CYCLES_INVALID",
        got: s.maxResumeCycles,
        hint: "CLI outer resume attempts. Example: 5",
      });
    }
    if (s.capacity != null && Number(s.capacity) > 10_000) {
      warnings.push(
        `stream.capacity is ${s.capacity} — large ring buffers increase memory per live stream`
      );
    }
  }

  // Retry / jitter
  const retry = cfg.retry || cfg.agent?.retry;
  if (retry) {
    // Each of these is a RANGE check written with relational operators, and
    // every comparison against a non-number is false — so `retries < 0 ||
    // retries > 20` cannot reject "two". The asymmetry is the danger: the
    // guard rejects 99 (harmless, 100 attempts) and -1 (harmless, clamped to
    // one attempt) while certifying "two" as valid, and "two" is the one value
    // that removes the retry entirely — `attempt <= NaN` is false on the first
    // pass, so the call is never made and a bare `undefined` is thrown. Check
    // that it is a number BEFORE asking where in the range it sits.
    const notANumber = (v) => v != null && !Number.isFinite(Number(v));
    if (notANumber(retry.retries)) {
      errors.push(`retry.retries must be a number (got ${JSON.stringify(retry.retries)})`);
    } else if (retry.retries != null && (retry.retries < 0 || retry.retries > 20)) {
      errors.push("retry.retries must be 0–20");
    }
    if (notANumber(retry.baseMs)) {
      errors.push(`retry.baseMs must be a number (got ${JSON.stringify(retry.baseMs)})`);
    } else if (retry.baseMs != null && retry.baseMs < 0) {
      errors.push("retry.baseMs must be >= 0");
    }
    if (notANumber(retry.maxDelayMs)) {
      errors.push(`retry.maxDelayMs must be a number (got ${JSON.stringify(retry.maxDelayMs)})`);
    } else if (retry.maxDelayMs != null && retry.baseMs != null && retry.maxDelayMs < retry.baseMs) {
      errors.push("retry.maxDelayMs must be >= retry.baseMs");
    }
    if (retry.strategy != null) {
      const resolved = resolveJitterStrategy(retry.strategy);
      const raw = String(retry.strategy).toLowerCase();
      if (
        !JITTER_STRATEGIES.includes(raw) &&
        !["full-jitter", "full_jitter", "equal-jitter", "equal_jitter", "decorrelated-jitter", "decorrelated_jitter", "exponential", "exp"].includes(raw)
      ) {
        warnings.push(
          `retry.strategy "${retry.strategy}" unknown; will use "${resolved}"`
        );
      }
      // normalize in place for callers
      retry.strategy = resolved;
    }
  }

  // Security
  if (cfg.security?.bypassApprovals === true) {
    // A machine that never asks should say so every time it starts.
    warnings.push(
      "security.bypassApprovals=true — FULL AUTONOMY: no tool call will ever ask for approval, at any risk tier"
    );
  }
  if (cfg.security?.autoApprove === true && Array.isArray(cfg.security?.requireApproval) && cfg.security.requireApproval.length) {
    warnings.push(
      "security.autoApprove=true with requireApproval list — approvals may be auto-granted"
    );
  }

  return { ok: errors.length === 0, errors, warnings, details, cfg };
}
