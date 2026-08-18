/**
 * Secret redaction for toolTrace, logs, WS/SSE events.
 */

export const REDACTED = "[REDACTED]";

export const SECRET_PATTERNS = [
  /\bxai-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /(Authorization:\s*Bearer\s+)[A-Za-z0-9._\-+=\/]+/gi,
  /(Bearer\s+)[A-Za-z0-9._\-+=\/]{12,}/g,
  /(["']?(?:api[_-]?key|apiKey|access[_-]?token|refresh[_-]?token|secret|password|token)["']?\s*[:=]\s*["'])([^"']{8,})(["'])/gi,
  /\b((?:XAI|OPENAI|ANTHROPIC|GITHUB|TELEGRAM|DISCORD|SLACK|AWS|GOOGLE)_(?:API_)?(?:KEY|TOKEN|SECRET))\s*=\s*([^\s"']{8,})/gi,
];

export function redactString(input) {
  if (input == null) return input;
  let s = String(input);
  for (const re of SECRET_PATTERNS) {
    re.lastIndex = 0;
    s = s.replace(re, (...args) => {
      if (
        args.length >= 4 &&
        typeof args[1] === "string" &&
        args[1].match(/Bearer|Authorization|api|token|KEY|SECRET|=/i)
      ) {
        if (
          (args[3] != null && String(args[3]).startsWith('"')) ||
          args[3] === "'" ||
          args[3] === '"'
        ) {
          return `${args[1]}${REDACTED}${args[3]}`;
        }
        if (/^[A-Z0-9_]+$/.test(args[1])) return `${args[1]}=${REDACTED}`;
        return `${args[1]}${REDACTED}`;
      }
      return REDACTED;
    });
  }
  return s;
}

export function redactValue(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, seen));
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const keyLower = k.toLowerCase();
    if (
      /^(api[_-]?key|token|secret|password|authorization|access[_-]?token|refresh[_-]?token)$/i.test(
        keyLower
      )
    ) {
      out[k] = typeof v === "string" && v.length > 0 ? REDACTED : v;
      continue;
    }
    out[k] = redactValue(v, seen);
  }
  return out;
}

export function redactToolTraceEntry(entry) {
  if (!entry || typeof entry !== "object") return entry;
  const out = { ...entry };
  if (out.args) out.args = redactValue(out.args);
  if (out.argsSummary) out.argsSummary = redactString(String(out.argsSummary));
  if (typeof out.result === "string") out.result = redactString(out.result);
  if (out.resultView?.text) {
    out.resultView = {
      ...out.resultView,
      text: redactString(out.resultView.text),
    };
  }
  if (out.error) {
    out.error =
      typeof out.error === "string"
        ? redactString(out.error)
        : redactValue(out.error);
  }
  return out;
}

export function redactToolTrace(trace = []) {
  if (!Array.isArray(trace)) return trace;
  return trace.map(redactToolTraceEntry);
}

export function redactEvent(event) {
  return redactValue(event);
}

export default {
  REDACTED,
  SECRET_PATTERNS,
  redactString,
  redactValue,
  redactToolTraceEntry,
  redactToolTrace,
  redactEvent,
};
