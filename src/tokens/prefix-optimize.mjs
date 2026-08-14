/**
 * Prefix cache hit rate optimizers.
 *
 * Rules:
 *  1. Normalize whitespace so accidental drift doesn't bust cache
 *  2. Freeze system message after build
 *  3. Sort tool schemas by name for stable JSON order
 *  4. Fingerprint prefix for diagnostics
 *  5. Prefer non-system channels for mid-run warnings (don't insert
 *     extra system messages that some stacks treat as prefix-adjacent)
 */

import crypto from "node:crypto";

/**
 * Normalize text for stable prefixes: trim, LF newlines, collapse 3+ blank lines.
 */
export function normalizePrefixText(text) {
  if (text == null) return "";
  let s = String(text);
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.trim();
  return s;
}

/**
 * Normalize system message content (string or multipart).
 */
export function normalizeSystemMessage(message) {
  if (!message || message.role !== "system") return message;
  const content = message.content;
  if (typeof content === "string") {
    return { ...message, content: normalizePrefixText(content) };
  }
  if (Array.isArray(content)) {
    return {
      ...message,
      content: content.map((part) => {
        if (part && part.type === "text" && typeof part.text === "string") {
          return { ...part, text: normalizePrefixText(part.text) };
        }
        return part;
      }),
    };
  }
  return message;
}

/**
 * Stable JSON for tool schemas: sort tools by function.name, sort key order shallowly.
 */
export function stabilizeTools(tools) {
  if (!Array.isArray(tools)) return tools;
  const sorted = [...tools].sort((a, b) => {
    const na = a?.function?.name || a?.name || "";
    const nb = b?.function?.name || b?.name || "";
    return na.localeCompare(nb);
  });
  // Re-serialize via sorted keys for each tool to avoid key-order drift from parsers
  return sorted.map((t) => sortObjectDeep(t));
}

function sortObjectDeep(value) {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortObjectDeep(value[key]);
    }
    return out;
  }
  return value;
}

/**
 * Fingerprint the cacheable prefix (system content + tool schemas).
 */
export function fingerprintPrefix({ systemMessage, tools }) {
  const sys =
    typeof systemMessage?.content === "string"
      ? systemMessage.content
      : JSON.stringify(systemMessage?.content ?? "");
  const toolBlob = JSON.stringify(tools ?? []);
  const payload = sys + "\n--\n" + toolBlob;
  const hash = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
  return {
    hash,
    systemChars: sys.length,
    toolsCount: Array.isArray(tools) ? tools.length : 0,
    toolsChars: toolBlob.length,
  };
}

/**
 * Ensure messages[0] is unchanged; returns true if still equal by fingerprint.
 */
export function assertPrefixStable(messages, expectedHash, tools) {
  if (!messages?.length || !expectedHash) return { ok: true };
  const fp = fingerprintPrefix({ systemMessage: messages[0], tools });
  return {
    ok: fp.hash === expectedHash,
    expected: expectedHash,
    actual: fp.hash,
  };
}

/**
 * Guard / loop warnings as user-role notes instead of system, so providers
 * that only cache the leading system block stay clean.
 */
export function makeEphemeralNotice(text) {
  return {
    role: "user",
    content: `[XClaw notice] ${text}`,
  };
}

/**
 * Apply full prefix optimization pipeline.
 */
export function optimizePrefix({ systemMessage, tools }) {
  const sys = normalizeSystemMessage(systemMessage);
  const stableTools = stabilizeTools(tools);
  const fp = fingerprintPrefix({ systemMessage: sys, tools: stableTools });
  // Freeze shallowly to catch accidental mutation in dev
  try {
    Object.freeze(sys);
    if (Array.isArray(sys.content)) Object.freeze(sys.content);
  } catch {
    /* ignore */
  }
  return { systemMessage: sys, tools: stableTools, fingerprint: fp };
}

/**
 * Clone a frozen system message for re-injection (Object.freeze makes it read-only).
 */
export function cloneSystemMessage(systemMessage) {
  if (!systemMessage) return { role: "system", content: "" };
  if (typeof systemMessage.content === "string") {
    return { role: "system", content: systemMessage.content };
  }
  if (Array.isArray(systemMessage.content)) {
    return {
      role: "system",
      content: systemMessage.content.map((p) =>
        p && typeof p === "object" ? { ...p } : p
      ),
    };
  }
  return { role: "system", content: String(systemMessage.content ?? "") };
}

/**
 * Force messages[0] to the frozen system prefix and drop any extra system
 * messages that would sit after the prefix (they bust automatic caches).
 * Returns { messages, restored, strippedSystem }.
 */
export function ensurePrefixStable(messages, frozenSystem, expectedHash, tools) {
  if (!Array.isArray(messages) || !messages.length || !frozenSystem) {
    return { messages, restored: false, strippedSystem: 0, ok: true };
  }
  let strippedSystem = 0;
  const next = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (i === 0) continue;
    if (m?.role === "system") {
      strippedSystem += 1;
      continue;
    }
    next.push(m);
  }
  const head = cloneSystemMessage(frozenSystem);
  const out = [head, ...next];
  const stab = assertPrefixStable(out, expectedHash, tools);
  const restored =
    strippedSystem > 0 ||
    !stab.ok ||
    messages[0]?.content !== head.content;
  return {
    messages: out,
    restored: Boolean(restored || !stab.ok),
    strippedSystem,
    ok: stab.ok,
    expected: stab.expected,
    actual: stab.actual,
  };
}

/**
 * Default cache-optimize policy (merge under cfg.tokens).
 */
export function defaultCacheOptimizePolicy(cfg = {}) {
  const t = cfg.tokens || {};
  return {
    restorePrefixEachTurn: t.restorePrefixEachTurn !== false,
    stripExtraSystem: t.stripExtraSystem !== false,
    // Keep system byte-stable for the whole run (best for xAI/OpenAI auto-cache).
    // Skill-detail slimming after turn 1 *changes* the prefix and hurts hit rate.
    slimSkillsAfterTurn: t.cacheSkillsAfterTurn ?? null,
    cacheBreakpoints: {
      enabled: t.cacheBreakpoints?.enabled !== false,
      mode: t.cacheBreakpoints?.mode || "auto",
      ...(t.cacheBreakpoints || {}),
    },
  };
}

