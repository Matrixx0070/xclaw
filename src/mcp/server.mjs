/**
 * Adapted from OpenClaw (MIT) — tools-stdio-server / channel-tools patterns
 * Lightweight MCP JSON-RPC server (HTTP) exposing XClaw tools + session helpers.
 */
import { createMcpToolHandlers, handleMcpJsonRpc } from "./handlers.mjs";
import { conversationDescriptor, summarizeStructuredResult, mcpError } from "./shared.mjs";
import { listSessions, getSessionByKey } from "../sessions/router.mjs";

/**
 * Build built-in MCP tools that mirror OpenClaw channel MCP surface (subset).
 */
export function createXclawBuiltinMcpTools(ctx = {}) {
  return [
    {
      name: "conversations_list",
      description: "List XClaw sessions available through session routes.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number" },
          channel: { type: "string" },
        },
      },
      async execute(args = {}) {
        let sessions = listSessions();
        if (args.channel) {
          sessions = sessions.filter((s) => s.channel === args.channel);
        }
        if (args.limit) sessions = sessions.slice(0, args.limit);
        const conversations = sessions.map((s) =>
          conversationDescriptor({
            sessionKey: s.sessionKey,
            channel: s.channel,
            peerId: s.peerId,
            title: s.title,
            updatedAt: s.updatedAt,
          })
        );
        return summarizeStructuredResult("conversations", conversations.length, {
          conversations,
        });
      },
    },
    {
      name: "conversation_get",
      description: "Get one XClaw conversation by session key.",
      inputSchema: {
        type: "object",
        properties: { session_key: { type: "string" } },
        required: ["session_key"],
      },
      async execute({ session_key }) {
        const s = getSessionByKey(session_key);
        if (!s) return mcpError(`conversation not found: ${session_key}`);
        const conversation = conversationDescriptor({
          sessionKey: s.sessionKey,
          channel: s.channel,
          peerId: s.peerId,
          title: s.title,
          updatedAt: s.updatedAt,
        });
        return {
          content: [{ type: "text", text: `conversation ${conversation.sessionKey}` }],
          structuredContent: { conversation },
        };
      },
    },
    ...(ctx.extraTools || []),
  ];
}

export function createMcpServer(opts = {}) {
  const tools = opts.tools || createXclawBuiltinMcpTools(opts);
  const handlers = createMcpToolHandlers(tools);

  async function handleRequest(body) {
    return handleMcpJsonRpc(handlers, body);
  }

  return { handlers, handleRequest, tools };
}
