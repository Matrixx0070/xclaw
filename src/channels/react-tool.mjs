/**
 * `react` agent tool (spec §16.3 wiring).
 *
 * Registered only when the inbound channel provided a react-capable
 * channelContext — channels without one never advertise the tool. Plans
 * through planGlyphAction (spec §16.2) so per-channel add/remove/clear
 * rules hold; the default target is the message the agent is answering.
 */
import { applyConversationGlyph } from "./conversation-glyph.mjs";

export function createReactTool(channelContext = {}) {
  const { channel, messageId, adapter } = channelContext;
  return {
    name: "react",
    description:
      `React to the user's current ${channel || "chat"} message with an emoji ` +
      `(visible in the chat, not a text reply). Empty emoji clears the bot's reaction. ` +
      `Optional messageId targets another message in this chat.`,
    parameters: {
      type: "object",
      properties: {
        emoji: {
          type: "string",
          description: 'Emoji character, e.g. "👍". Empty string clears.',
        },
        remove: {
          type: "boolean",
          description: "Remove this emoji instead of adding it.",
        },
        messageId: {
          type: "string",
          description: "Target message id (defaults to the current message).",
        },
      },
    },
    execute: async (args = {}) => {
      try {
        const result = await applyConversationGlyph({
          adapter,
          channel,
          messageId: args.messageId || messageId,
          glyph: args.emoji,
          remove: args.remove === true,
          clearAll: args.clearAll === true,
        });
        return { ok: result?.ok !== false, ...(result || {}) };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    },
  };
}
