/**
 * Adapted from OpenClaw (MIT) — src/mcp/channel-shared.ts patterns
 * Shared MCP payload helpers (no zod / SDK dependency).
 */

export function summarizeStructuredResult(kind, count, extra = {}) {
  return {
    content: [
      {
        type: "text",
        text: `${kind}: ${count}`,
      },
    ],
    structuredContent: extra,
  };
}

/** Conversation route descriptor (OpenClaw-shaped, trimmed). */
export function conversationDescriptor(row = {}) {
  return {
    sessionKey: row.sessionKey || row.key || "",
    channel: row.channel || row.lastChannel || "webchat",
    to: row.to || row.lastTo || row.peerId || "",
    accountId: row.accountId || row.lastAccountId,
    threadId: row.threadId || row.lastThreadId,
    label: row.label,
    displayName: row.displayName,
    derivedTitle: row.derivedTitle || row.title,
    lastMessagePreview: row.lastMessagePreview,
    updatedAt: row.updatedAt ?? null,
  };
}

export function mcpTextResult(text, { isError = false, structuredContent } = {}) {
  return {
    content: [{ type: "text", text: String(text) }],
    ...(isError ? { isError: true } : {}),
    ...(structuredContent ? { structuredContent } : {}),
  };
}

export function mcpError(message) {
  return mcpTextResult(message, { isError: true });
}
