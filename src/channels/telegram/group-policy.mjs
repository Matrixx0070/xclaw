/**
 * Telegram group / forum-topic policy (P2).
 *
 * groupPolicy: open | mention | allowlist
 * requireMention: bot must be @mentioned (or reply-to-bot)
 * allowedGroupIds / topics map
 */

/**
 * @param {object} conf channels.telegram
 */
export function groupPolicyOptions(conf = {}) {
  const g = conf.groups && typeof conf.groups === "object" ? conf.groups : {};
  return {
    /** open | mention | allowlist */
    policy: String(g.policy || conf.groupPolicy || "mention").toLowerCase(),
    requireMention: g.requireMention !== false && conf.requireMention !== false,
    allowedGroupIds: normalizeIdList(
      g.allowedChatIds || g.allowedGroupIds || conf.allowedGroupIds
    ),
    /** message_thread_id → { requireMention?, allowFrom? } */
    topics: g.topics && typeof g.topics === "object" ? g.topics : {},
  };
}

function normalizeIdList(v) {
  if (v == null) return null;
  if (!Array.isArray(v)) return null;
  return v.map((x) => String(x));
}

/**
 * Detect if message @mentions the bot or is a reply to the bot.
 * @param {object} msg Telegram message
 * @param {{ id?: number, username?: string }} botInfo
 */
export function messageMentionsBot(msg, botInfo = {}) {
  if (!msg) return false;
  const uname = (botInfo.username || "").toLowerCase();
  const botId = botInfo.id != null ? String(botInfo.id) : null;

  // Reply to bot
  const reply = msg.reply_to_message;
  if (reply?.from?.is_bot && botId && String(reply.from.id) === botId) {
    return true;
  }
  if (reply?.from?.is_bot && uname && (reply.from.username || "").toLowerCase() === uname) {
    return true;
  }

  const entities = msg.entities || msg.caption_entities || [];
  const text = msg.text || msg.caption || "";
  for (const ent of entities) {
    if (ent.type === "mention" && uname) {
      const slice = text.slice(ent.offset, ent.offset + ent.length);
      if (slice.replace(/^@/, "").toLowerCase() === uname) return true;
    }
    if (ent.type === "text_mention" && botId && ent.user) {
      if (String(ent.user.id) === botId) return true;
    }
  }

  // Fallback: plain text contains @username
  if (uname && text.toLowerCase().includes(`@${uname}`)) return true;

  return false;
}

/**
 * Gate group/supergroup (and optional topic) messages.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function gateGroupMessage({ msg, conf, botInfo }) {
  const chatType = msg?.chat?.type || "private";
  if (chatType !== "group" && chatType !== "supergroup") {
    return { ok: true, reason: "not_group" };
  }

  const opts = groupPolicyOptions(conf || {});
  const chatId = String(msg.chat.id);
  const threadId =
    msg.message_thread_id != null ? String(msg.message_thread_id) : null;

  // Topic-level override
  let topicRule = null;
  if (threadId && opts.topics[threadId]) {
    topicRule = opts.topics[threadId];
  }

  if (opts.policy === "allowlist") {
    if (!opts.allowedGroupIds || !opts.allowedGroupIds.includes(chatId)) {
      return { ok: false, reason: "group_not_allowlisted" };
    }
  }

  if (topicRule?.allowFrom) {
    const fromId = msg.from?.id != null ? String(msg.from.id) : null;
    const allowed = normalizeIdList(topicRule.allowFrom) || [];
    if (fromId && allowed.length && !allowed.includes(fromId)) {
      return { ok: false, reason: "topic_user_not_allowed" };
    }
  }

  const needMention =
    topicRule?.requireMention != null
      ? Boolean(topicRule.requireMention)
      : opts.policy === "open"
        ? false
        : opts.policy === "mention" || opts.requireMention;

  if (needMention) {
    if (!messageMentionsBot(msg, botInfo)) {
      return { ok: false, reason: "mention_required" };
    }
  }

  return { ok: true, reason: opts.policy };
}

/**
 * Strip @bot mention from text for cleaner agent input.
 */
export function stripBotMention(text, botInfo = {}) {
  let t = String(text || "");
  const uname = botInfo.username;
  if (uname) {
    t = t.replace(new RegExp(`@${uname}\\b`, "gi"), "").trim();
  }
  return t.replace(/\s+/g, " ").trim();
}

export default {
  groupPolicyOptions,
  messageMentionsBot,
  gateGroupMessage,
  stripBotMention,
};
