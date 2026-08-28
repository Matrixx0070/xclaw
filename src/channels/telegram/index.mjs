/**
 * Telegram channel — deepened with OpenClaw allow-from + session bindings.
 */
import { replyWithAgent, truncate } from "../base.mjs";
import { isNewApprovalAsk } from "../../security/approval-events.mjs";
import { processInbound, fromTelegramUpdate } from "../runtime.mjs";
import { createChannelPolicy, workspaceForChat } from "../policy.mjs";
import { resolveBinding, touchSession } from "../../sessions/router.mjs";
import { buildSessionKey } from "../../sessions/session-key.mjs";
import {
  createPairingStore,
  buildPairingReply,
} from "../../pairing/pairing-store.mjs";
import { createRateLimiter } from "../rate-limit.mjs";
import { authorizeTelegramCallback } from "./callback-auth.mjs";
import { handleChannelCommand } from "../commands.mjs";
import {
  createTelegramStreamer,
  telegramStreamOptions,
} from "./stream.mjs";
import {
  verifyTelegramWebhookSecret,
  acquireTelegramWriterLock,
  buildSetWebhookBody,
  TELEGRAM_SECRET_HEADER,
} from "./webhook.mjs";
import {
  pairingInlineKeyboard,
  approvalInlineKeyboard,
  parseCallbackData,
  formatPendingApprovalText,
} from "./inline.mjs";
import { getSharedApprovalGate } from "../../security/approvals.mjs";
import {
  recordTelegramUpdate,
  recordTelegramEdit,
  recordTelegramDeny,
  recordTelegramError,
  recordTelegramCallback,
  recordTelegramStreamDelta,
  recordTelegramStructuredOut,
} from "./metrics.mjs";
import {
  synthesizeReplyVoice,
  sendTelegramVoiceNote,
  voiceOutOptions,
} from "./voice-out.mjs";
import { localTranscribe } from "../../voice/providers/local.mjs";
import { mdToTelegramHtml, mdToPlain } from "./markdown.mjs";
import {
  gateGroupMessage,
  stripBotMention,
  groupPolicyOptions,
} from "./group-policy.mjs";
import {
  hasStructuredContent,
  extractStructuredInbound,
  structuredToAgentHint,
} from "./structured-inbound.mjs";
import { deliverStructuredReply } from "./structured-outbound.mjs";
import { buildReactionCall } from "./react.mjs";
import { resolveAckGlyph } from "../conversation-glyph.mjs";
import {
  suggestionsInlineKeyboard,
  formatSuggestionsPlain,
  recordSuggestionFeedback,
} from "../../agent/suggestions.mjs";
import { recordDurableSuggestionFeedback } from "../../agent/suggestion-feedback.mjs";
import { recordSuggestionTapMetric } from "../../agent/agent-metrics.mjs";
import {
  classifyTelegramError,
  telegramApiError,
  backoffMsFromClassification,
  redactTelegramToken,
  telegramRequestTimeoutMs,
} from "./errors.mjs";
import { runTelegramPollLoop } from "./poll-loop.mjs";
import { enrichStickerMeta } from "./sticker-meta.mjs";
import { chunkText, prepareReplyChunks, resolveChunkLimits } from "./chunk-text.mjs";

// Overridable for tests and self-hosted Bot API servers; read at call time so
// a test can point an already-imported module at a local mock.
const DEFAULT_API = "https://api.telegram.org";
function apiBase() {
  return process.env.XCLAW_TELEGRAM_API_BASE || DEFAULT_API;
}

export function createTelegramChannel(cfg) {
  const conf = cfg.channels?.telegram || {};
  const token =
    conf.token || process.env.TELEGRAM_BOT_TOKEN || process.env.XCLAW_TELEGRAM_TOKEN;
  const enabled = conf.enabled === true && Boolean(token);
  const workingDir = conf.workingDir;
  const policy = createChannelPolicy(cfg);
  const dmPolicy = conf.dmPolicy || "pairing"; // open | allowlist | pairing
  const rateLimiter = createRateLimiter(conf.rateLimit || cfg.channels?.rateLimit || {});
  const pairing = createPairingStore({
    storePath: conf.pairingStorePath,
  });

  /** poll (default) | webhook */
  const transport = String(conf.transport || conf.mode || "poll").toLowerCase();
  const webhookUrl = conf.webhookUrl || conf.webhook?.url || process.env.XCLAW_TELEGRAM_WEBHOOK_URL || null;
  const webhookSecret =
    conf.webhookSecret ||
    conf.webhook?.secret ||
    process.env.XCLAW_TELEGRAM_WEBHOOK_SECRET ||
    null;
  const ownerChatId =
    conf.ownerChatId ||
    conf.owner_chat_id ||
    process.env.XCLAW_TELEGRAM_OWNER_CHAT_ID ||
    null;
  const singleWriter = conf.singleWriter !== false;

  let offset = 0;
  let stopped = false;
  let starting = false;
  let loopPromise = null;
  let botInfo = null;
  let messagesHandled = 0;
  let callbacksHandled = 0;
  let lastError = null;
  let lastPollOkAt = null;
  let lastPollErrorAt = null;
  let consecutivePollFails = 0;
  let lastOkAt = null;
  let loopAlive = false;
  let writerLock = null;
  // Set when singleWriter mode declines the start because another process
  // holds the lock. running:false is then BY DESIGN, not a fault, and the
  // health watchdog must not try to restart its way out of it.
  let writerStandby = false;
  let seenUpdateIds = new Set();
  const SEEN_MAX = 2000;
  /** @type {Map<string, { prompt: string, chatId: string|number, at: number }>} */
  const suggestionStore = new Map();
  const SUG_TTL_MS = 30 * 60 * 1000;

  function rememberSuggestions(chatId, items) {
    const now = Date.now();
    for (const [k, v] of suggestionStore) {
      if (now - v.at > SUG_TTL_MS) suggestionStore.delete(k);
    }
    for (const s of items || []) {
      if (s?.id && s?.prompt) {
        suggestionStore.set(s.id, {
          prompt: s.prompt,
          chatId,
          label: s.label,
          source: s.source,
          kind: s.kind,
          at: now,
        });
      }
    }
  }

  async function api(method, body) {
    const url = `${apiBase()}/bot${token}/${method}`;
    let r;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        // Node's fetch has no default request timeout. Without this a
        // half-open socket parks the caller forever — on getUpdates that
        // suspends the poll loop inside the request, so it never stamps
        // lastPollOkAt/lastPollErrorAt and the watchdog reads it as alive.
        // The budget clears getUpdates' own long-poll window (see
        // telegramRequestTimeoutMs) so a legitimate idle poll never
        // self-aborts. requestTimeoutMs/longPollMarginMs are operator
        // escape hatches (e.g. a slow self-hosted Bot API server) and let
        // tests exercise the hang path without a real 30s wait.
        signal: AbortSignal.timeout(
          telegramRequestTimeoutMs(method, body, {
            baseMs: conf.requestTimeoutMs,
            longPollMarginMs: conf.longPollMarginMs,
          })
        ),
      });
    } catch (err) {
      const e = new Error(`Telegram ${method}: ${redactTelegramToken(err.message || err, token)}`);
      e.code = err.code || "NETWORK";
      throw e;
    }
    let j;
    try {
      j = await r.json();
    } catch {
      throw telegramApiError(method, { description: `Invalid JSON HTTP ${r.status}` }, r.status);
    }
    if (!j.ok) {
      throw telegramApiError(method, j, r.status);
    }
    return j.result;
  }

  async function sendChatAction(chatId, action = "typing") {
    try {
      await api("sendChatAction", { chat_id: chatId, action });
    } catch {
      /* ignore */
    }
  }

  const { chunkMax, maxReplyChars } = resolveChunkLimits(conf);

  async function sendMessage(chatId, text, replyTo, extra = {}) {
    const chunks = prepareReplyChunks(text, {
      chunkMax,
      totalMax: maxReplyChars,
    });
    let last = null;
    for (let i = 0; i < chunks.length; i++) {
      const part = chunks[i];
      const body = {
        chat_id: chatId,
        text: part,
        disable_web_page_preview: true,
        ...extra,
      };
      if (replyTo != null && i === 0) body.reply_to_message_id = replyTo;
      // only attach keyboard on last chunk
      if (i < chunks.length - 1) delete body.reply_markup;
      // Render the agent's markdown (bold/code/links) instead of showing
      // literal ** asterisks (Frank, 2026-08-24). HTML mode with a plain
      // fallback: if Telegram rejects the entities, the text still arrives.
      if (extra.parse_mode === undefined) {
        try {
          const html = mdToTelegramHtml(part);
          if (html !== part) {
            last = await api("sendMessage", { ...body, text: html, parse_mode: "HTML" });
            continue;
          }
        } catch {
          /* fall through to plain send */
        }
      }
      last = await api("sendMessage", body);
    }
    return last;
  }

  async function answerCallback(callbackQueryId, text) {
    try {
      await api("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        text: text || undefined,
        show_alert: false,
      });
    } catch {
      /* ignore */
    }
  }

  /**
   * Notify owner of a pending tool approval (inline buttons).
   */
  // One prompt per pending: the loop emits approval_required twice (once at
  // creation via onPending, again as a state update when authorize times
  // out). Live-observed: Frank got identical prompts exactly 120s apart and
  // tapped Allow on pendings whose turn had already moved on.
  const promptedApprovals = new Set();

  async function notifyOwnerApproval(item) {
    if (!ownerChatId || !item?.id) return { ok: false, reason: "no_owner" };
    if (promptedApprovals.has(item.id)) return { ok: false, reason: "already_prompted" };
    try {
      await sendMessage(
        ownerChatId,
        formatPendingApprovalText(item).replace(/\*/g, ""),
        undefined,
        { reply_markup: approvalInlineKeyboard({ pendingId: item.id, tool: item.tool }) }
      );
      // log delivery: raw sendMessage bypasses the reply-path "→" logging, so
      // without this line the gateway log cannot show whether the approval
      // prompt ever reached the owner (bit us diagnosing a live SLA-denial)
      console.log(`[telegram] → ${ownerChatId}: approval prompt ${item.id} (${item.tool})`);
      // latch only on successful delivery — a failed send must stay eligible
      // for the loop's natural re-emission
      if (promptedApprovals.size > 200) promptedApprovals.clear();
      promptedApprovals.add(item.id);
      return { ok: true };
    } catch (err) {
      console.warn(`[telegram] approval prompt ${item.id} FAILED: ${err.message}`);
      return { ok: false, reason: err.message };
    }
  }

  /**
   * Notify owner of a pairing request.
   */
  async function notifyOwnerPairing({ code, chatId, username }) {
    if (!ownerChatId) return { ok: false, reason: "no_owner" };
    const text = [
      "🔗 Pairing request",
      `Chat: ${chatId}`,
      username ? `User: @${username}` : null,
      `Code: ${code}`,
      "",
      "Approve or deny:",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await sendMessage(ownerChatId, text, undefined, {
        reply_markup: pairingInlineKeyboard({ code, chatId }),
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  async function downloadTelegramFile(fileId, destPath) {
    // Retried: a single transient `fetch failed` was silently eating whole
    // voice notes (Frank's 4s note at 11:10, 2026-08-24 — he had to repeat
    // himself). 3 attempts with short backoff.
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 750));
      try {
        const f = await api("getFile", { file_id: fileId });
        const filePath = f.file_path;
        if (!filePath) throw new Error("no file_path from getFile");
        const url = `${apiBase()}/file/bot${token}/${filePath}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`download HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.writeFile(destPath, buf);
        return { path: destPath, bytes: buf.length, telegramPath: filePath };
      } catch (err) {
        lastErr = err;
        console.warn(
          `[telegram] media download attempt ${attempt + 1}/3 failed: ${redactTelegramToken(err.message, token)}`
        );
      }
    }
    throw lastErr;
  }

  /**
   * Extract text + optional media paths from a Telegram message.
   * Photos/documents/voice/video are downloaded under workspace/telegram-media/.
   */
  async function extractMessageContent(msg, workspace) {
    const path = await import("node:path");
    const parts = [];
    const media = [];
    if (msg.text) parts.push(msg.text.trim());
    if (msg.caption) parts.push(msg.caption.trim());

    const mediaDir = path.join(workspace || process.cwd(), "telegram-media");
    const stamp = `${msg.message_id || Date.now()}`;

    try {
      if (msg.photo && msg.photo.length) {
        const best = msg.photo[msg.photo.length - 1];
        const dest = path.join(mediaDir, `photo_${stamp}.jpg`);
        const d = await downloadTelegramFile(best.file_id, dest);
        media.push({ type: "photo", ...d });
        parts.push(`[Attached photo saved to ${d.path}]`);
      }
      if (msg.document) {
        const name = msg.document.file_name || `doc_${stamp}`;
        const dest = path.join(mediaDir, name.replace(/[^\w.\-]+/g, "_"));
        const d = await downloadTelegramFile(msg.document.file_id, dest);
        media.push({ type: "document", ...d, mime: msg.document.mime_type });
        parts.push(`[Attached document saved to ${d.path}]`);
      }
      if (msg.voice) {
        const dest = path.join(mediaDir, `voice_${stamp}.ogg`);
        const d = await downloadTelegramFile(msg.voice.file_id, dest);
        media.push({ type: "voice", ...d });
        parts.push(`[Attached voice note saved to ${d.path}]`);
        try {
          const tr = await localTranscribe(d.path, cfg);
          if (tr.ok && tr.text) {
            media[media.length - 1].transcript = tr.text;
            media[media.length - 1].sttProvider = tr.provider;
            parts.push(`[Voice transcript (${tr.provider}): ${tr.text}]`);
            // Use transcript as primary user text if no caption
            if (!msg.caption && !msg.text) {
              parts.unshift(tr.text);
            }
          } else if (tr.error) {
            parts.push(`[Voice STT unavailable: ${tr.error}]`);
          }
        } catch (sttErr) {
          parts.push(`[Voice STT error: ${sttErr.message || sttErr}]`);
        }
      }
      if (msg.video) {
        const dest = path.join(mediaDir, `video_${stamp}.mp4`);
        const d = await downloadTelegramFile(msg.video.file_id, dest);
        media.push({ type: "video", ...d });
        parts.push(`[Attached video saved to ${d.path}]`);
      }
      if (msg.audio) {
        const name = msg.audio.file_name || `audio_${stamp}.mp3`;
        const dest = path.join(mediaDir, name.replace(/[^\w.\-]+/g, "_"));
        const d = await downloadTelegramFile(msg.audio.file_id, dest);
        media.push({ type: "audio", ...d });
        parts.push(`[Attached audio saved to ${d.path}]`);
        try {
          const tr = await localTranscribe(d.path, cfg);
          if (tr.ok && tr.text) {
            media[media.length - 1].transcript = tr.text;
            parts.push(`[Audio transcript (${tr.provider}): ${tr.text}]`);
            if (!msg.caption && !msg.text) parts.unshift(tr.text);
          }
        } catch {
          /* */
        }
      }
    } catch (err) {
      parts.push(`[Media download failed: ${redactTelegramToken(err.message, token)}]`);
    }

    // P3 structured: sticker, location, venue, contact, poll, …
    const structuredPack = extractStructuredInbound(msg);
    for (const line of structuredPack.textParts) parts.push(line);
    // Optional: download sticker/animation/video_note binary for workspace
    try {
      if (msg.sticker?.file_id) {
        const ext = msg.sticker.is_video ? "webm" : msg.sticker.is_animated ? "tgs" : "webp";
        const dest = path.join(mediaDir, `sticker_${stamp}.${ext}`);
        const d = await downloadTelegramFile(msg.sticker.file_id, dest);
        media.push({ type: "sticker", ...d, emoji: msg.sticker.emoji });
        parts.push(`[Sticker file saved to ${d.path}]`);
      }
      if (msg.animation?.file_id) {
        const dest = path.join(mediaDir, `anim_${stamp}.mp4`);
        const d = await downloadTelegramFile(msg.animation.file_id, dest);
        media.push({ type: "animation", ...d });
        parts.push(`[Animation saved to ${d.path}]`);
      }
      if (msg.video_note?.file_id) {
        const dest = path.join(mediaDir, `videonote_${stamp}.mp4`);
        const d = await downloadTelegramFile(msg.video_note.file_id, dest);
        media.push({ type: "video_note", ...d });
        parts.push(`[Video note saved to ${d.path}]`);
      }
    } catch (err) {
      parts.push(`[Structured media download failed: ${err.message}]`);
    }

    return {
      text: parts.filter(Boolean).join("\n\n").trim(),
      media,
      structured: structuredPack.structured,
    };
  }

  function authorizeCallback(cq, data) {
    const fromId = cq.from?.id;
    const chatId = cq.message?.chat?.id ?? fromId;
    return authorizeTelegramCallback({
      fromId,
      chatId,
      data,
      ownerChatId,
      dmPolicy,
      allowFrom: conf.allowedChatIds || conf.allowFrom || [],
      isApproved: (ch, id) => pairing.isApproved(ch, id),
      rateLimiter,
    });
  }

  async function handleCallbackQuery(cq) {
    if (!cq || !cq.id) return;
    const data = parseCallbackData(cq.data);
    if (!data) {
      await answerCallback(cq.id, "Unknown action");
      return;
    }
    const auth = authorizeCallback(cq, data);
    if (!auth.ok) {
      recordTelegramDeny(auth.code || "callback");
      await answerCallback(cq.id, auth.message || "Not authorized");
      return;
    }
    try {
      if (data.kind === "pair") {
        if (data.action === "approve") {
          const r = pairing.approve("telegram", data.id);
          await answerCallback(cq.id, r?.ok ? "Approved" : "Failed");
          if (cq.message?.chat?.id && cq.message?.message_id) {
            try {
              await api("editMessageText", {
                chat_id: cq.message.chat.id,
                message_id: cq.message.message_id,
                text: r?.ok
                  ? `✅ Pairing approved: ${data.id}`
                  : `❌ Pairing approve failed: ${data.id}`,
              });
            } catch {
              /* */
            }
          }
        } else if (data.action === "deny") {
          // leave pending; optional revoke by not approving
          await answerCallback(cq.id, "Denied (left unpaired)");
          if (cq.message?.chat?.id && cq.message?.message_id) {
            try {
              await api("editMessageText", {
                chat_id: cq.message.chat.id,
                message_id: cq.message.message_id,
                text: `❌ Pairing denied: ${data.id}`,
              });
            } catch {
              /* */
            }
          }
        }
        recordTelegramCallback(data.action === "approve" ? "pair_approve" : "pair_deny");
        callbacksHandled += 1;
        lastOkAt = new Date().toISOString();
        return;
      }
      if (data.kind === "apr") {
        const gate = getSharedApprovalGate(cfg);
        const approved = data.action === "ok";
        const r = gate.decide(data.id, approved, approved ? "telegram_inline" : "telegram_deny");
        await answerCallback(
          cq.id,
          r.ok ? (approved ? "Allowed" : "Denied") : "Unknown or expired"
        );
        if (cq.message?.chat?.id && cq.message?.message_id) {
          try {
            await api("editMessageText", {
              chat_id: cq.message.chat.id,
              message_id: cq.message.message_id,
              text: r.ok
                ? `${approved ? "✅ Allowed" : "❌ Denied"} ${data.id}`
                : `⚠️ ${data.id} not pending`,
            });
          } catch {
            /* */
          }
        }
        recordTelegramCallback(approved ? "apr_ok" : "apr_no");
        callbacksHandled += 1;
        lastOkAt = new Date().toISOString();
        return;
      }
      if (data.kind === "sug") {
        const entry = suggestionStore.get(data.id);
        await answerCallback(cq.id, entry ? "Running…" : "Expired");
        if (!entry) return;
        recordSuggestionFeedback({
          suggestionId: data.id,
          prompt: entry.prompt,
          event: "tapped",
          chatId: entry.chatId,
        });
        try { recordSuggestionTapMetric(); } catch { /* */ }
        recordDurableSuggestionFeedback(cfg, {
          event: "tapped",
          source: entry.source,
          kind: entry.kind,
          prompt: entry.prompt,
          suggestionId: data.id,
          userId: cq.from?.id != null ? String(cq.from.id) : undefined,
          chatId: entry.chatId,
        }).catch(() => {});
        // Re-inject as a user message into the same chat
        const fakeMsg = {
          message_id: cq.message?.message_id,
          chat: cq.message?.chat || { id: entry.chatId, type: "private" },
          from: cq.from,
          text: entry.prompt,
        };
        callbacksHandled += 1;
        lastOkAt = new Date().toISOString();
        recordTelegramCallback("sug");
        await handleUpdate({
          update_id: Date.now(),
          message: fakeMsg,
        });
        return;
      }
    } catch (err) {
      lastError = err.message || String(err);
      recordTelegramError("callback");
      await answerCallback(cq.id, "Error");
    }
  }

  async function handleUpdate(update) {
    if (!update) return;
    // Dedup (webhook retries / double delivery)
    if (update.update_id != null) {
      const uid = Number(update.update_id);
      if (seenUpdateIds.has(uid)) return;
      seenUpdateIds.add(uid);
      if (seenUpdateIds.size > SEEN_MAX) {
        const drop = [...seenUpdateIds].slice(0, SEEN_MAX / 2);
        for (const x of drop) seenUpdateIds.delete(x);
      }
    }
    if (update.callback_query) {
      recordTelegramUpdate("callback_query");
      await handleCallbackQuery(update.callback_query);
      return;
    }
    const msg = update.message || update.edited_message;
    if (!msg) return;
    // Allow media-only + structured (sticker/location/contact/…) messages
    const hasMedia = Boolean(
      msg.photo || msg.document || msg.voice || msg.video || msg.audio
    );
    const hasStructured = hasStructuredContent(msg);
    if (!msg.text && !msg.caption && !hasMedia && !hasStructured) return;
    const chatId = msg.chat.id;
    const chatType = msg.chat.type || "private";
    const peerKind =
      chatType === "group" || chatType === "supergroup" ? "group" : "dm";

    // Group / topic policy (P2)
    if (peerKind === "group") {
      const g = gateGroupMessage({ msg, conf, botInfo });
      if (!g.ok) {
        console.log(`[telegram] group deny ${chatId}: ${g.reason}`);
        recordTelegramDeny(g.reason || "group");
        return;
      }
    }

    // Access policy
    if (dmPolicy === "allowlist") {
      const gate = policy.gateTelegram(update);
      if (!gate.ok) {
        console.log(`[telegram] deny chat ${chatId}`);
        recordTelegramDeny("allowlist");
        return;
      }
    } else if (dmPolicy === "pairing" && peerKind === "dm") {
      const allowedStatic = policy.gateTelegram(update).ok;
      const approved = pairing.isApproved("telegram", chatId);
      if (!allowedStatic && !approved) {
        const { created, code } = pairing.upsertPairingRequest({
          channel: "telegram",
          id: String(chatId),
          meta: { username: msg.from?.username || "" },
        });
        if (created) {
          await sendMessage(
            chatId,
            buildPairingReply({
              channel: "telegram",
              idLine: `Your chat id: ${chatId}`,
              code,
            }),
            msg.message_id
          );
          await notifyOwnerPairing({
            code,
            chatId,
            username: msg.from?.username || "",
          });
        }
        return;
      }
    }
    // dmPolicy === "open" → allow all

    const session = resolveBinding("telegram", String(chatId), peerKind);
    touchSession(session.id);
    const sessionKey = session.sessionKey || buildSessionKey({
      channel: "telegram",
      peerKind,
      peerId: String(chatId),
    });
    const workspace = session.workingDir || workspaceForChat(cfg, "telegram", chatId, workingDir);
    const extracted = await extractMessageContent(msg, workspace);
    let text = extracted.text || "";
    if (peerKind === "group" && botInfo?.username) {
      text = stripBotMention(text, botInfo);
    }
    if (!text) return;

    const voiceOpts = voiceOutOptions(conf);
    const wantVoice =
      voiceOpts.enabled &&
      (voiceOpts.mode === "always" ||
        (voiceOpts.mode === "on_request" &&
          (/\/voice\b/i.test(text) || Boolean(msg.voice))));
    if (wantVoice) {
      text = text.replace(/\/voice\b/gi, "").trim() || text;
    }

    if (text === "/start" || text === "/help") {
      await sendMessage(
        chatId,
        [
          "XClaw Telegram channel",
          "",
          "Send a message — computer tools available.",
          "/job /queue /approve /pending /resume — job mode",
          "/status — health · /session — session key",
          "Voice: /voice /mute /unmute /cancel · say stop talking / cancel that",
        ].join("\n"),
        msg.message_id
      );
      return;
    }
    if (text === "/status") {
      await sendMessage(
        chatId,
        `XClaw Telegram up · @${botInfo?.username || "?"} · handled ${messagesHandled}`,
        msg.message_id
      );
      return;
    }
    if (text === "/session") {
      await sendMessage(
        chatId,
        `session ${session.id}\nkey ${sessionKey}`,
        msg.message_id
      );
      return;
    }

    let typing = null;
    console.log(`[telegram] ← ${chatId}: ${text.slice(0, 80)}`);
    const streamOpts = telegramStreamOptions(conf);
    const streamer = streamOpts.enabled
      ? createTelegramStreamer({
          api,
          chatId,
          replyToMessageId: msg.message_id,
          minEditIntervalMs: streamOpts.minEditIntervalMs,
          maxLen: chunkMax,
          maxTotal: maxReplyChars,
          truncate: (s, n) => truncate(s, n),
          onEdit: (info) => {
            recordTelegramEdit(info?.notModified ? "noop" : info?.ok ? "ok" : "err");
          },
        })
      : null;

    try {
      if (streamer) {
        try {
          await streamer.sendPlaceholder();
        } catch (err) {
          console.warn(`[telegram] stream placeholder failed:`, err.message || err);
        }
      }

      // Chat action "typing" while agent runs (best-effort)
      try {
        await sendChatAction(chatId, "typing");
        typing = setInterval(() => {
          sendChatAction(chatId, "typing").catch(() => {});
        }, 4000);
      } catch {
        typing = null;
      }

      // Conversation glyphs (spec §16.3): react adapter bound to this chat.
      // Telegram sets the bot's whole reaction list — remove/clear = empty.
      const channelContext = {
        channel: "telegram",
        messageId: String(msg.message_id),
        adapter: {
          react: async ({ messageId, op, emoji }) => {
            const call = buildReactionCall({
              chatId,
              messageId: messageId ?? msg.message_id,
              op,
              emoji,
            });
            const res = await api(call.method, call.body);
            return { ok: res?.ok !== false, op, emoji: emoji || "" };
          },
        },
      };
      // Ack glyph while the agent works — only when configured (default off).
      const ackGlyph = resolveAckGlyph({
        ackConfig: conf.ackReaction,
        identityGlyph: conf.identityGlyph,
      });
      if (ackGlyph) {
        channelContext.adapter
          .react({ messageId: String(msg.message_id), op: "add", emoji: ackGlyph })
          .catch((err) => {
            console.warn(`[telegram] ack react failed:`, err?.message || err);
          });
      }

      const inbound = fromTelegramUpdate({ message: msg });
      inbound.text = text;
      const structuredHint = structuredToAgentHint(extracted.structured || []);
      if (structuredHint) {
        inbound.text = [text, structuredHint].filter(Boolean).join("\n\n");
      }
      inbound.files = (extracted.media || []).map((m) => ({
        name: m.path || m.type,
        path: m.path,
        type: m.type,
      }));
      inbound.structured = extracted.structured || [];
      recordTelegramUpdate("message");
      const out = await processInbound(inbound, {
        cfg: {
          ...cfg,
          agent: {
            ...(cfg.agent || {}),
            model: session.agentModel || cfg.agent?.model,
          },
        },
        workingDir: workspace,
        rateLimiter,
        channelContext,
        stream: streamOpts.enabled && streamOpts.partialText !== false,
        // detached mission updates (objective runtime) push through the bot
        notify: async (t) => {
          await sendMessage(chatId, String(t).slice(0, 3900));
          console.log(`[telegram] → ${chatId}: [mission] ${String(t).slice(0, 60)}`);
        },
        onEvent: (e) => {
          if (e.type === "tool" && e.phase === "start") {
            console.log(`[telegram]   → ${e.name}`);
            if (streamer && streamOpts.showTools) {
              streamer.onToolStart(e.name).catch(() => {});
            }
          } else if (e.type === "lifecycle" && e.phase === "start" && streamer) {
            streamer.update("Thinking…").catch(() => {});
          } else if (e.type === "model" && e.phase === "delta" && streamer && e.accumulated) {
            streamer.setPartial(e.accumulated).catch(() => {});
            recordTelegramStreamDelta();
          } else if (e.type === "security" && e.phase === "approval_required") {
            // restate/timedOut re-emissions are state updates on an
            // already-prompted pending — never a fresh ask
            if (isNewApprovalAsk(e) && !e.timedOut) {
              notifyOwnerApproval({
                id: e.pendingId,
                tool: e.name,
                args: e.args,
              }).catch(() => {});
            }
          } else if (e.type === "security" && e.phase === "denied") {
            recordTelegramDeny(e.reason || "security");
          }
        },
      });
      if (out.handled && out.reply) {
        let replyText = String(out.reply);
        try {
          const structured = await deliverStructuredReply({
            api,
            chatId,
            replyTo: msg.message_id,
            text: replyText,
          });
          replyText = structured.text || "";
          if (structured.sent) {
            recordTelegramStructuredOut("batch");
            console.log(
              `[telegram] structured outbound sent=${structured.sent}` +
                (structured.errors?.length
                  ? ` errors=${structured.errors.length}`
                  : "")
            );
          }
        } catch (serr) {
          console.warn(`[telegram] structured outbound:`, serr.message || serr);
        }
        if (replyText.trim()) {
          if (streamer) {
            await streamer.finish(replyText);
          } else {
            await sendMessage(chatId, replyText, msg.message_id);
          }
        } else if (streamer) {
          streamer.close();
        }
        // Deliver any images the agent produced (generate_image / edit_image)
        // as actual photos — the text reply alone left the picture on the server.
        if (Array.isArray(out.images) && out.images.length) {
          const { sendPhotoFile, sendPhotoUrl, isImageUrl } = await import("./photo-out.mjs");
          for (const imgPath of out.images.slice(0, 10)) {
            try {
              // Artifacts can be local files OR remote URLs (weather icons
              // etc.) — a URL fed to the file sender fails ENOENT.
              const r = isImageUrl(imgPath)
                ? await sendPhotoUrl({ token, chatId, url: imgPath, replyTo: msg.message_id })
                : await sendPhotoFile({ token, chatId, filePath: imgPath, replyTo: msg.message_id });
              if (r.ok) console.log(`[telegram] 🖼 ${r.method} ${imgPath.split("/").pop()}`);
              else console.warn(`[telegram] photo send failed (${imgPath}): ${r.error}`);
            } catch (ierr) {
              console.warn(`[telegram] photo-out error:`, ierr.message || ierr);
            }
          }
        }
        if (wantVoice) {
          try {
            const syn = await synthesizeReplyVoice(out.reply, cfg, conf.voiceOut || {});
            if (syn.ok) {
              await sendTelegramVoiceNote({
                token,
                chatId,
                filePath: syn.path,
                replyTo: msg.message_id,
                caption: voiceOpts.caption ? mdToPlain(out.reply).slice(0, 200) : undefined,
                format: syn.format,
              });
              console.log(`[telegram] ♪ voice via ${syn.provider}`);
            } else {
              console.warn(`[telegram] voice-out skipped: ${syn.reason}`);
            }
          } catch (verr) {
            console.warn(`[telegram] voice-out error:`, verr.message || verr);
            recordTelegramError("voice_out");
          }
        }
        const suggestions = out.suggestions || [];
        if (suggestions.length) {
          rememberSuggestions(chatId, suggestions);
          for (const s of suggestions) {
            recordSuggestionFeedback({
              suggestionId: s.id,
              prompt: s.prompt,
              event: "shown",
              chatId,
            });
            recordDurableSuggestionFeedback(cfg, {
              event: "shown",
              source: s.source,
              kind: s.kind,
              prompt: s.prompt,
              suggestionId: s.id,
              userId: out.vaultUserId || out.userId || out.identity,
              chatId,
            }).catch(() => {});
          }
          const mode =
            conf.suggestions?.telegramMode ||
            cfg.suggestions?.telegramMode ||
            "keyboard";
          try {
            if (mode === "keyboard" || mode === "both") {
              const kb = suggestionsInlineKeyboard(suggestions);
              if (kb) {
                await sendMessage(
                  chatId,
                  "Next steps:",
                  undefined,
                  { reply_markup: kb }
                );
              }
            }
            if (mode === "plain" || mode === "both") {
              const plain = formatSuggestionsPlain(suggestions);
              if (plain) await sendMessage(chatId, plain);
            }
          } catch (sugErr) {
            console.warn(`[telegram] suggestions:`, sugErr.message || sugErr);
          }
        }
        messagesHandled += 1;
        lastOkAt = new Date().toISOString();
        lastError = null;
        console.log(`[telegram] → ${chatId}: ${String(out.reply).slice(0, 80)}`);
      } else if (streamer) {
        // Command-only or empty — delete placeholder noise by finishing with a short note
        streamer.close();
      }
    } catch (err) {
      const isInternal =
        err instanceof ReferenceError ||
        err instanceof TypeError ||
        err instanceof SyntaxError;
      const c = isInternal
        ? {
            code: "INTERNAL",
            message: String(err?.message || err),
            userMessage: "Something went wrong on my side — try again.",
          }
        : classifyTelegramError(err);
      lastError = c.message;
      recordTelegramError("handle");
      console.error(`[telegram] error:`, c.code, c.message);
      try {
        const userMsg = `Error: ${c.userMessage}`;
        if (streamer) {
          await streamer.finish(userMsg);
        } else {
          await sendMessage(chatId, userMsg, msg.message_id);
        }
      } catch {
        /* ignore */
      }
    } finally {
      try {
        streamer?.close?.();
      } catch {
        /* */
      }
      if (typing) {
        try {
          clearInterval(typing);
        } catch {
          /* */
        }
        typing = null;
      }
    }
  }

  async function pollLoop() {
    await runTelegramPollLoop({
      api,
      conf,
      botUsername: botInfo?.username,
      isStopped: () => stopped,
      getOffset: () => offset,
      setOffset: (v) => {
        offset = v;
      },
      onTouchLock: () => {
        try {
          writerLock?.touch?.();
        } catch {
          /* */
        }
      },
      onUpdate: handleUpdate,
      onPollOk: () => {
        lastPollOkAt = new Date().toISOString();
        consecutivePollFails = 0;
      },
      onError: (info) => {
        lastError = info.message || info.code;
        recordTelegramError(info.phase || "poll");
        if ((info.phase || "poll") === "poll") {
          lastPollErrorAt = new Date().toISOString();
          consecutivePollFails += 1;
        }
        if (info.code === "UNAUTHORIZED") {
          stopped = true;
        }
      },
    });
    loopAlive = false;
  }

  return {
    name: "telegram",
    get enabled() {
      return enabled;
    },
    async start() {
      if (!enabled) {
        console.log(`[telegram] disabled (set channels.telegram.enabled + token)`);
        return;
      }
      // 2026-08-24 restart storm: the health watchdog and a manual
      // /channels/manage/restart interleaved, each stop() flagging the loop the
      // other's start() then revived — two concurrent poll loops terminated each
      // other's getUpdates (CONFLICT) every second until a process restart. A
      // live loop makes start a no-op, and a start already in flight is not
      // begun twice; createChannelManager additionally serializes lifecycle
      // calls per channel.
      // Neither no-op is a failed start: the channel is up, or the call that
      // is up-ing it is already in flight. Only startInner's own declines
      // count against the watchdog.
      if (starting) {
        console.warn(`[telegram] start already in flight — skip`);
        return { started: true, reason: "start_in_flight" };
      }
      if (loopAlive && !stopped) {
        console.warn(`[telegram] already running — start skipped`);
        return { started: true, reason: "already_running" };
      }
      starting = true;
      try {
        return await this.startInner();
      } finally {
        starting = false;
      }
    },
    async startInner() {
      if (singleWriter) {
        writerLock = acquireTelegramWriterLock({
          lockPath: conf.writerLockPath,
        });
        if (!writerLock.ok) {
          console.warn(
            `[telegram] single-writer lock not acquired (${writerLock.reason}) — skip start (another process owns updates)`
          );
          lastError = `writer_lock:${writerLock.reason}`;
          writerStandby = true;
          return { started: false, reason: lastError, standby: true };
        }
        writerStandby = false;
        console.log(`[telegram] writer lock ok pid=${process.pid}`);
      }
      // Retried: one transient Bad Gateway here at gateway boot (2026-08-24
      // 19:57) killed the channel until the watchdog's next pass — the poll
      // loop retries everything, but this pre-loop call had no second chance.
      // Bounded like downloadTelegramFile; non-retryable errors (bad token)
      // still fail immediately.
      let getMeAttempt = 0;
      for (;;) {
        try {
          botInfo = await api("getMe");
          break;
        } catch (err) {
          const c = classifyTelegramError(err);
          getMeAttempt += 1;
          if (!c.retryable || getMeAttempt >= 4) throw err;
          const delay = Math.min(3000, backoffMsFromClassification(c, getMeAttempt));
          console.warn(
            `[telegram] getMe ${c.code} — retry ${getMeAttempt}/3 in ${delay}ms`
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      console.log(`[telegram] bot @${botInfo.username} (id ${botInfo.id}) transport=${transport}`);
      stopped = false;
      lastError = null;

      if (transport === "webhook") {
        if (!webhookUrl) {
          lastError = "webhook_url_missing";
          console.error(`[telegram] transport=webhook but channels.telegram.webhookUrl not set`);
          // A misconfiguration no restart can fix. Reported as a declined
          // start so the watchdog counts it and its circuit-open alert
          // ("manual intervention needed") is actually reachable.
          return { started: false, reason: lastError };
        }
        if (!webhookSecret) {
          console.warn(`[telegram] webhook without secret_token — set channels.telegram.webhookSecret`);
        }
        // Drop long-poll conflict
        try {
          await api("deleteWebhook", { drop_pending_updates: false });
        } catch {
          /* */
        }
        await api(
          "setWebhook",
          buildSetWebhookBody({
            url: webhookUrl,
            secretToken: webhookSecret,
          })
        );
        loopAlive = true;
        console.log(`[telegram] webhook set → ${webhookUrl}`);
        return { started: true };
      }

      // poll mode: ensure webhook cleared
      try {
        await api("deleteWebhook", { drop_pending_updates: false });
      } catch {
        /* */
      }
      loopAlive = true;
      loopPromise = pollLoop().finally(() => {
        loopAlive = false;
      });
      return { started: true };
    },
    markError(msg) {
      lastError = msg;
    },
    async stop() {
      stopped = true;
      loopAlive = false;
      const ownedLoop = Boolean(loopPromise);
      try {
        // The interrupter exists to cut short OUR OWN in-flight long poll so
        // stop() returns promptly. Firing it without a loop of our own is not
        // a harmless no-op: getUpdates on a shared token 409-terminates
        // whichever process IS polling. A standby instance (writer lock held
        // elsewhere) would otherwise kill the real writer's poll on every
        // watchdog restart pass.
        if (token && transport === "poll" && ownedLoop) {
          await api("getUpdates", { offset, timeout: 0 });
        }
      } catch {
        /* ignore */
      }
      if (loopPromise) {
        await loopPromise.catch(() => {});
        loopPromise = null;
      }
      try {
        writerLock?.release?.();
      } catch {
        /* */
      }
      writerLock = null;
      writerStandby = false;
    },
    status() {
      return {
        name: "telegram",
        enabled,
        username: botInfo?.username || null,
        messagesHandled,
        callbacksHandled,
        policy: dmPolicy,
        transport,
        webhookUrl: transport === "webhook" ? webhookUrl : null,
        ownerChatId: ownerChatId ? String(ownerChatId) : null,
        singleWriter,
        writerLock: Boolean(writerLock?.ok),
        standby: writerStandby,
        running: enabled && loopAlive && !stopped,
        loopAlive,
        stopped,
        lastError,
        lastOkAt,
        // poll-level liveness (the watchdog's outage signal)
        lastPollOkAt,
        lastPollErrorAt,
        consecutivePollFails,
        stream: telegramStreamOptions(conf).enabled,
        voiceOut: voiceOutOptions(conf).enabled,
        groups: groupPolicyOptions(conf),
        pollTimeoutSec: conf.pollTimeoutSec ?? conf.poll?.timeoutSec ?? 30,
      };
    },
    /** Ingest one Update (webhook or tests). */
    async handleUpdate(update) {
      return handleUpdate(update);
    },
    /** HTTP webhook helper: verify secret then handle. */
    async handleWebhookRequest(req, body) {
      const v = verifyTelegramWebhookSecret(req, webhookSecret || "");
      if (!v.ok) return { ok: false, ...v };
      await handleUpdate(body);
      return { ok: true };
    },
    notifyOwnerApproval,
    get webhookSecretConfigured() {
      return Boolean(webhookSecret);
    },
  };
}
