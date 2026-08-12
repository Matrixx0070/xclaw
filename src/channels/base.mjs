/**
 * Shared helpers for messaging channels → agent loop.
 */
import { runAgentLoop } from "../agent/loop.mjs";
import { truncateForChannel } from "../utils/unicode-truncate.mjs";

/**
 * Run the agent for an inbound channel message and return reply text.
 */
export async function replyWithAgent({
  cfg,
  message,
  workingDir,
  onEvent,
  signal,
  userId,
  channel,
  chatId,
  stream = false,
}) {
  const { runWithRequestContext } = await import("../connected/request-context.mjs");
  const { normalizeChannelUserId, resolveVaultUserId } = await import(
    "../connected/account-links.mjs"
  );
  const identity = normalizeChannelUserId({ channel, userId, chatId });
  let vaultUserId = identity;
  try {
    vaultUserId = await resolveVaultUserId(cfg, { channel, userId, chatId });
  } catch {
    vaultUserId = identity;
  }
  const run = async () => {
    const result = await runAgentLoop({
      userMessage: message,
      cfg,
      workingDir: workingDir || process.cwd(),
      signal,
      onEvent,
      userId: vaultUserId,
      channel,
      chatId,
      stream,
    });
    return {
      text: result.text || "(no response)",
      turns: result.turns,
      model: result.model,
      toolTrace: result.toolTrace,
      suggestions: result.suggestions || [],
      turnState: result.turnState || null,
      identity,
      vaultUserId,
    };
  };
  if (userId || channel || chatId) {
    return runWithRequestContext(
      { userId: vaultUserId, identity, channel, chatId },
      run
    );
  }
  return run();
}

/**
 * UTF-16–safe channel truncate (Telegram-accurate; no split emoji).
 * @param {string} str
 * @param {number} [max=3900]
 */
export function truncate(str, max = 3900) {
  return truncateForChannel(str, max, "\n…(truncated)");
}
