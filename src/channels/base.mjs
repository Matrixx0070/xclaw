/**
 * Shared helpers for messaging channels → agent loop.
 */
import { runAgentLoop } from "../agent/loop.mjs";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
/** Pull image file paths the agent produced (generate_image / edit_image …)
 *  from the tool trace's collected artifacts, so channels can deliver them. */
function extractImageArtifacts(toolTrace = []) {
  const out = [];
  for (const t of toolTrace || []) {
    for (const a of t.artifacts || []) {
      const ref = a?.ref || a?.path || a?.filePath;
      if (typeof ref === "string" && IMAGE_EXT.test(ref) && !out.includes(ref)) out.push(ref);
    }
  }
  return out;
}
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
  /** Objective-segment plumbing: fresh context + dedicated transcript +
   *  segment-boundary rescue instruction (see agent/objective.mjs) */
  history,
  chatSessionId,
  rescuePrompt,
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
      ...(history !== undefined ? { history } : {}),
      ...(chatSessionId ? { chatSessionId } : {}),
      ...(rescuePrompt ? { rescuePrompt } : {}),
    });
    return {
      text: result.text || "(no response)",
      turns: result.turns,
      model: result.model,
      toolTrace: result.toolTrace,
      images: extractImageArtifacts(result.toolTrace),
      suggestions: result.suggestions || [],
      turnState: result.turnState || null,
      stopReason: result.stopReason || null,
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
