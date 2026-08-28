/**
 * Channel policy — OpenClaw allow-from adapted + XClaw telegram/discord/slack gates.
 */
import {
  compileAllowlist,
  isSenderIdAllowed,
  mergeDmAllowFromSources,
  resolveGroupAllowFromSources,
  formatAllowFromLowercase,
} from "./allow-from.mjs";

export function createChannelPolicy(cfg = {}) {
  const telegram = cfg.channels?.telegram || {};
  const discord = cfg.channels?.discord || {};
  const slack = cfg.channels?.slack || {};

  const tgAllow = compileAllowlist(
    mergeDmAllowFromSources({
      allowFrom: telegram.allowedChatIds || telegram.allowFrom,
      storeAllowFrom: telegram.storeAllowFrom,
      dmPolicy: telegram.dmPolicy,
    })
  );

  const tgGroupAllow = compileAllowlist(
    resolveGroupAllowFromSources({
      allowFrom: telegram.allowedChatIds || telegram.allowFrom,
      groupAllowFrom: telegram.groupAllowFrom,
      fallbackToAllowFrom: telegram.fallbackGroupToDm !== false,
    })
  );

  const dcAllow = compileAllowlist(
    discord.allowedChannelIds || discord.allowFrom || []
  );

  // Slack gates on the SENDER (msg.user) — the only unenforced axis: poll mode
  // already restricts WHERE (channelIds) but not WHO, and socket-mode
  // app_mentions arrive from any channel the bot is in. Allowlist = Slack user IDs.
  const slackAllow = compileAllowlist(
    slack.allowFrom || slack.allowedUserIds || []
  );

  function allowedChatId(id) {
    return isSenderIdAllowed(tgAllow, id == null ? undefined : String(id), true);
  }

  function allowedDiscordChannel(id) {
    return isSenderIdAllowed(dcAllow, id == null ? undefined : String(id), true);
  }

  function gateTelegram(update) {
    const chatId =
      update?.message?.chat?.id ??
      update?.callback_query?.message?.chat?.id ??
      null;
    const chatType = update?.message?.chat?.type;
    if (chatId == null) return { ok: false, reason: "no_chat" };
    const allow =
      chatType === "group" || chatType === "supergroup" ? tgGroupAllow : tgAllow;
    if (!isSenderIdAllowed(allow, String(chatId), true)) {
      return { ok: false, reason: "chat_not_allowed", chatId };
    }
    return { ok: true, chatId };
  }

  function gateDiscord(message) {
    const channelId = message?.channelId || message?.channel_id;
    if (!channelId) return { ok: false, reason: "no_channel" };
    if (!allowedDiscordChannel(channelId)) {
      return { ok: false, reason: "channel_not_allowed", channelId };
    }
    return { ok: true, channelId };
  }

  function gateSlack(msg) {
    const userId = msg?.user ?? msg?.userId ?? null;
    if (userId == null || userId === "") return { ok: false, reason: "no_sender" };
    if (!isSenderIdAllowed(slackAllow, String(userId), true)) {
      return { ok: false, reason: "sender_not_allowed", userId };
    }
    return { ok: true, userId };
  }

  return {
    allowedChatId,
    allowedDiscordChannel,
    gateTelegram,
    gateDiscord,
    gateSlack,
    compileAllowlist,
    formatAllowFromLowercase,
    tgAllow,
    dcAllow,
    slackAllow,
  };
}

export {
  compileAllowlist,
  isSenderIdAllowed,
  isEmailSenderAllowed,
  extractSenderAddress,
  mergeDmAllowFromSources,
  resolveGroupAllowFromSources,
} from "./allow-from.mjs";


/**
 * The per-chat workspace bindings for a channel.
 *
 * Two key spellings are live and both resolve at runtime, so this is the only
 * honest answer to "which chats are bound where?". Any reader that checks just
 * one spelling reports on half the configs the runtime actually honours.
 */
export function chatWorkspaceMap(cfg, channel) {
  const conf = cfg?.channels?.[channel] || {};
  return conf.workspaceByChatId || conf.workspaces || {};
}

/**
 * Per-chat workspace binding: channels.<name>.workspaceByChatId[id]
 */
export function workspaceForChat(cfg, channel, chatId, fallback) {
  const conf = cfg?.channels?.[channel] || {};
  const map = chatWorkspaceMap(cfg, channel);
  const id = chatId == null ? "" : String(chatId);
  return map[id] || conf.workingDir || fallback || undefined;
}
