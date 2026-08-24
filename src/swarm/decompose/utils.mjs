/**
 * Utility Functions
 * Shared helpers for the entire swarm system
 */
import { randomUUID } from "crypto";
import { createHash } from "crypto";

export function generateTaskId() {
  return `task_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function generateAgentId(role = "sub") {
  return `${role}_agent_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function generateCallId() {
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function hashContent(content) {
  return createHash("sha256").update(String(content)).digest("hex").slice(0, 16);
}

export function truncateText(text, maxTokens = 4000) {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...[truncated]";
}

export function estimateTokens(text) {
  if (!text) return 0;
  // Rough estimate: ~3 chars per token for mixed English/Chinese
  return Math.ceil(text.length / 3);
}

export function formatDuration(seconds) {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nowISO() {
  return new Date().toISOString();
}

export function now() {
  return Date.now();
}

export function clamp(num, min, max) {
  return Math.min(Math.max(num, min), max);
}

export function retryWithBackoff(fn, maxAttempts = 3, baseDelay = 1000) {
  return async function (...args) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn(...args);
      } catch (e) {
        if (attempt === maxAttempts) throw e;
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.warn(`[swarm] Retry ${attempt}/${maxAttempts} after ${delay}ms: ${e.message}`);
        await sleep(delay);
      }
    }
  };
}

export function debounce(fn, ms) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), ms);
  };
}

export function throttle(fn, ms) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      return fn.apply(this, args);
    }
  };
}

export function mergeDicts(base, override) {
  if (!override || typeof override !== "object") return override;
  const result = { ...base };
  for (const key in override) {
    if (override[key] && typeof override[key] === "object" && !Array.isArray(override[key])) {
      result[key] = mergeDicts(base[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

export function pick(obj, keys) {
  const result = {};
  for (const key of keys) {
    if (key in obj) result[key] = obj[key];
  }
  return result;
}

export function omit(obj, keys) {
  const result = { ...obj };
  for (const key of keys) delete result[key];
  return result;
}

export function groupBy(array, key) {
  return array.reduce((acc, item) => {
    const k = item[key];
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

export function flatten(array) {
  return array.reduce((acc, val) => acc.concat(Array.isArray(val) ? flatten(val) : val), []);
}

export function unique(array) {
  return [...new Set(array)];
}

export function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export function isEmpty(obj) {
  if (obj == null) return true;
  if (Array.isArray(obj)) return obj.length === 0;
  if (typeof obj === "object") return Object.keys(obj).length === 0;
  return false;
}

export function safeJSONParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export function safeJSONStringify(obj, fallback = "null") {
  try {
    return JSON.stringify(obj);
  } catch {
    return fallback;
  }
}

// Token bucket rate limiter
export class TokenBucket {
  constructor(capacity, refillRate) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  _refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  consume(tokens = 1) {
    this._refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  waitTime(tokens = 1) {
    this._refill();
    const deficit = tokens - this.tokens;
    if (deficit <= 0) return 0;
    return Math.ceil((deficit / this.refillRate) * 1000);
  }
}
