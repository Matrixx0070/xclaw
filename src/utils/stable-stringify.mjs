/**
 * Stable JSON stringification for deterministic hashing (tool-loop detection, caches).
 *
 * Guarantees:
 * - Same semantic value → same string (key order independent for plain objects)
 * - Sorted object keys (recursive)
 * - Arrays keep order (sequence matters)
 * - undefined object values omitted
 * - undefined array elements → null
 * - bigint → decimal string
 * - Date → ISO string (via toJSON)
 * - Cycles → "[Circular]"
 * - Map / Set → tagged sorted structural form
 * - Compact (no whitespace) unless opts.space set
 */

import { createHash } from "node:crypto";

const CIRCULAR = "[Circular]";

/**
 * @param {unknown} value
 * @param {{ space?: number, replacer?: (key: string, value: unknown) => unknown }} [opts]
 * @returns {string}
 */
export function stableStringify(value, opts = {}) {
  const seen = new WeakSet();
  const replacer = opts.replacer;

  function normalize(val, key) {
    if (typeof replacer === "function") {
      val = replacer(key, val);
    }

    if (val === null || typeof val === "boolean") {
      return val;
    }

    if (typeof val === "number") {
      return Number.isFinite(val) ? val : null;
    }

    if (typeof val === "string") {
      return val;
    }

    if (typeof val === "bigint") {
      return val.toString();
    }

    if (typeof val === "undefined" || typeof val === "symbol" || typeof val === "function") {
      return undefined;
    }

    if (typeof val === "object") {
      if (typeof val.toJSON === "function") {
        try {
          return normalize(val.toJSON(), key);
        } catch {
          /* fall through */
        }
      }

      if (seen.has(val)) {
        return CIRCULAR;
      }

      if (val instanceof Date) {
        return Number.isNaN(val.getTime()) ? null : val.toISOString();
      }

      if (Array.isArray(val)) {
        seen.add(val);
        const out = val.map((item, i) => {
          const n = normalize(item, String(i));
          return n === undefined ? null : n;
        });
        seen.delete(val);
        return out;
      }

      if (val instanceof Map) {
        seen.add(val);
        const entries = [...val.entries()].map(([k, v]) => [
          normalize(k, ""),
          normalize(v, String(k)),
        ]);
        entries.sort((a, b) => cmp(a[0], b[0]));
        const tagged = {
          __type: "Map",
          entries: entries.map(([k, v]) => [k, v === undefined ? null : v]),
        };
        seen.delete(val);
        return tagged;
      }

      if (val instanceof Set) {
        seen.add(val);
        const items = [...val].map((v) => normalize(v, ""));
        items.sort((a, b) => cmp(a, b));
        const tagged = { __type: "Set", values: items };
        seen.delete(val);
        return tagged;
      }

      seen.add(val);
      const keys = Object.keys(val).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const out = {};
      for (const k of keys) {
        const n = normalize(val[k], k);
        if (n !== undefined) out[k] = n;
      }
      seen.delete(val);
      return out;
    }

    return undefined;
  }

  function cmp(a, b) {
    const sa = typeof a === "string" ? a : JSON.stringify(a);
    const sb = typeof b === "string" ? b : JSON.stringify(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }

  return JSON.stringify(normalize(value, ""), null, opts.space);
}

/**
 * Sync SHA-256 hex of stableStringify(value).
 * @param {unknown} value
 * @returns {string}
 */
export function stableHashSync(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

/**
 * Tool-call fingerprint used by loop detection.
 * @param {string} toolName
 * @param {unknown} params
 * @returns {string}  "toolName:<sha256>"
 */
export function hashToolCall(toolName, params) {
  return `${toolName}:${stableHashSync(params ?? {})}`;
}

export default stableStringify;
