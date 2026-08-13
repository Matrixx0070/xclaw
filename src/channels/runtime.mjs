/**
 * Shared multi-channel inbound runtime (CL multi-channel).
 *
 * Normalize → commands → rate limit → replyWithAgent → outbound text.
 * Channel modules stay responsible for transport; this owns the agent path.
 */
import { replyWithAgent as defaultReplyWithAgent } from "./base.mjs";
import { handleChannelCommand as defaultHandleCommand } from "./commands.mjs";
import { normalizeChannelUserId } from "../connected/account-links.mjs";

/**
 * @typedef {object} NormalizedInbound
 * @property {string} channel - telegram|slack|discord|email|webchat
 * @property {string} text
 * @property {string|null} userId - platform-native id
 * @property {string|null} chatId
 * @property {string|null} [threadId]
 * @property {boolean} [isBot]
 * @property {string|null} [username]
 * @property {Array<{name?: string, path?: string}>} [files]
 * @property {object} [raw]
 */

/**
 * Build a stable normalized inbound message.
 * @param {Partial<NormalizedInbound> & { channel: string }} input
 * @returns {NormalizedInbound}
 */
export function normalizeInbound(input = {}) {
  const channel = String(input.channel || "unknown").toLowerCase();
  let text = String(input.text || "").trim();
  const userId =
    input.userId != null && String(input.userId).trim() !== ""
      ? String(input.userId)
      : null;
  const chatId =
    input.chatId != null && String(input.chatId).trim() !== ""
      ? String(input.chatId)
      : null;

  // Strip Slack-style bot mention if botUserId provided
  if (input.botUserId && text) {
    text = text.replace(new RegExp(`<@${input.botUserId}>`, "g"), "").trim();
  }

  const files = Array.isArray(input.files) ? input.files : [];
  const identity = normalizeChannelUserId({ channel, userId, chatId });

  let isDm = input.isDm;
  if (isDm === undefined || isDm === null) {
    isDm =
      userId != null && chatId != null && String(userId) === String(chatId);
  } else {
    isDm = Boolean(isDm);
  }

  return {
    channel,
    text,
    userId,
    chatId,
    threadId: input.threadId || null,
    isDm,
    isBot: Boolean(input.isBot),
    username: input.username || null,
    files,
    identity,
    raw: input.raw || null,
  };
}

/**
 * Fixtures: convert platform-shaped events into NormalizedInbound.
 */
export function fromSlackMessage(msg, { channelId, botUserId } = {}) {
  const chId = channelId || msg?.channel || null;
  return normalizeInbound({
    channel: "slack",
    text: msg?.text || "",
    userId: msg?.user || null,
    chatId: chId,
    threadId: msg?.thread_ts || msg?.ts || null,
    isDm: Boolean(chId && String(chId).startsWith("D")),
    isBot: Boolean(msg?.bot_id || msg?.subtype === "bot_message"),
    files: Array.isArray(msg?.files)
      ? msg.files.map((f) => ({ name: f.name || f.id, path: null }))
      : [],
    botUserId,
    raw: msg,
  });
}

export function fromSlackAppMention(event, { botUserId } = {}) {
  return normalizeInbound({
    channel: "slack",
    text: event?.text || "",
    userId: event?.user || null,
    chatId: event?.channel || null,
    threadId: event?.thread_ts || event?.ts || null,
    isBot: false,
    botUserId,
    raw: event,
  });
}

export function fromTelegramUpdate(update) {
  const msg = update?.message || update?.edited_message || {};
  const chatId = msg.chat?.id != null ? String(msg.chat.id) : null;
  const userId = msg.from?.id != null ? String(msg.from.id) : chatId;
  const chatType = msg.chat?.type || "private";
  return normalizeInbound({
    channel: "telegram",
    text: msg.text || msg.caption || "",
    userId,
    chatId,
    threadId: msg.message_id != null ? String(msg.message_id) : null,
    isDm: chatType === "private",
    isBot: Boolean(msg.from?.is_bot),
    username: msg.from?.username || null,
    files: msg.photo || msg.document ? [{ name: "attachment" }] : [],
    raw: update,
  });
}

export function fromDiscordMessage(msg) {
  return normalizeInbound({
    channel: "discord",
    text: msg?.content || "",
    userId: msg?.author?.id != null ? String(msg.author.id) : null,
    chatId: msg?.channel_id != null ? String(msg.channel_id) : null,
    threadId: msg?.id != null ? String(msg.id) : null,
    isDm: msg?.guild_id == null && msg?.guildId == null,
    isBot: Boolean(msg?.author?.bot),
    username: msg?.author?.username || null,
    files: Array.isArray(msg?.attachments)
      ? msg.attachments.map((a) => ({ name: a.filename || a.id }))
      : [],
    raw: msg,
  });
}

export function fromEmailMessage(mail) {
  const from = String(mail?.from || mail?.fromAddress || "").trim();
  const subject = String(mail?.subject || "").trim();
  const body = String(mail?.text || mail?.body || "").trim();
  const text = [subject && `Subject: ${subject}`, body].filter(Boolean).join("\n\n");
  return normalizeInbound({
    channel: "email",
    text,
    userId: from || null,
    chatId: from || null,
    isDm: true,
    username: from || null,
    raw: mail,
  });
}

export function fromWebChatMessage({ message, sessionId, userId } = {}) {
  return normalizeInbound({
    channel: "webchat",
    text: message || "",
    userId: userId || sessionId || null,
    chatId: sessionId || null,
    raw: { message, sessionId },
  });
}

/**
 * Process one normalized inbound message through the shared agent path.
 *
 * @param {NormalizedInbound} inbound
 * @param {object} opts
 * @param {object} opts.cfg
 * @param {string} [opts.workingDir]
 * @param {Function} [opts.replyWithAgent]
 * @param {Function} [opts.handleCommand]
 * @param {{ allow: (key: string) => { ok: boolean } }} [opts.rateLimiter]
 * @param {Function} [opts.onEvent]
 * @returns {Promise<{
 *   handled: boolean,
 *   skipped?: string,
 *   reply?: string,
 *   via?: string,
 *   identity?: string,
 *   userId?: string|null,
 * }>}
 */
export async function processInbound(inbound, opts = {}) {
  const {
    cfg = {},
    workingDir = process.cwd(),
    replyWithAgent = defaultReplyWithAgent,
    handleCommand = defaultHandleCommand,
    rateLimiter = null,
    onEvent,
  } = opts;

  if (!inbound || inbound.isBot) {
    return { handled: false, skipped: "bot" };
  }

  let text = inbound.text || "";
  if (inbound.files?.length) {
    for (const f of inbound.files) {
      if (f.path) text += `\n\n[Attached file saved to ${f.path}]`;
      else if (f.name) text += `\n\n[Attachment: ${f.name}]`;
    }
    text = text.trim();
  }
  if (!text) return { handled: false, skipped: "empty" };

  // Slash commands
  if (text.startsWith("/")) {
    const cmd = await handleCommand({
      text,
      cfg,
      workingDir,
      channel: inbound.channel,
      userId: inbound.userId,
      chatId: inbound.chatId,
      isDm: inbound.isDm,
      onEvent,
    });
    if (cmd.handled) {
      return {
        handled: true,
        via: "command",
        reply: cmd.reply || "OK",
        identity: inbound.identity,
        userId: inbound.userId,
      };
    }
  }

  if (rateLimiter) {
    const key = `${inbound.channel}:${inbound.chatId || ""}:${inbound.userId || ""}`;
    const rl = rateLimiter.allow(key);
    if (!rl.ok) {
      return {
        handled: true,
        via: "rate_limit",
        reply: "Rate limit — try again shortly.",
        identity: inbound.identity,
      };
    }
  }

  const result = await replyWithAgent({
    cfg,
    message: text,
    workingDir,
    userId: inbound.userId,
    channel: inbound.channel,
    chatId: inbound.chatId,
    onEvent,
    stream: opts.stream === true,
  });

  return {
    handled: true,
    via: "agent",
    reply: result.text || "(no response)",
    images: result.images || [],
    identity: result.identity || inbound.identity,
    vaultUserId: result.vaultUserId,
    userId: inbound.userId,
    turns: result.turns,
    suggestions: result.suggestions || [],
  };
}
