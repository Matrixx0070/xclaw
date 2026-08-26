/**
 * Channel policy — OpenClaw allow-from adapted + XClaw telegram/discord gates.
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

  return {
    allowedChatId,
    allowedDiscordChannel,
    gateTelegram,
    gateDiscord,
    compileAllowlist,
    formatAllowFromLowercase,
    tgAllow,
    dcAllow,
  };
}

export {
  compileAllowlist,
  isSenderIdAllowed,
  isEmailSenderAllowed,
  mergeDmAllowFromSources,
  resolveGroupAllowFromSources,
} from "./allow-from.mjs";


/**
 * Per-chat workspace binding: channels.<name>.workspaceByChatId[id]
 */
export function workspaceForChat(cfg, channel, chatId, fallback) {
  const conf = cfg?.channels?.[channel] || {};
  const map = conf.workspaceByChatId || conf.workspaces || {};
  const id = chatId == null ? "" : String(chatId);
  return map[id] || conf.workingDir || fallback || undefined;
}
