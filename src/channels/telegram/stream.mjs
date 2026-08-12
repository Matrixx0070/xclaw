/**
 * Progressive Telegram replies via sendMessage + editMessageText.
 *
 * Telegram rate-limits edits; we throttle and coalesce pending text.
 * Message body clipped with UTF-16–safe truncate (API limit 4096).
 */

import {
  truncateUtf16,
  truncateGraphemesToUtf16Budget,
} from "../../utils/unicode-truncate.mjs";
import { splitHeadAndOverflow, prepareReplyChunks } from "./chunk-text.mjs";

/**
 * @param {object} opts
 * @param {(method: string, body?: object) => Promise<any>} opts.api
 * @param {string|number} opts.chatId
 * @param {number} [opts.replyToMessageId]
 * @param {number} [opts.minEditIntervalMs=1200]
 * @param {number} [opts.maxLen=4000]
 * @param {(s: string, max: number) => string} [opts.truncate]
 */
export function createTelegramStreamer(opts) {
  const api = opts.api;
  const chatId = opts.chatId;
  const replyTo = opts.replyToMessageId;
  const minEditIntervalMs = Math.max(250, Number(opts.minEditIntervalMs) || 1200);
  const maxLen = Math.max(100, Number(opts.maxLen) || 4000);
  const maxTotal = Math.max(maxLen, Number(opts.maxTotal) || 12_000);
  const truncate =
    opts.truncate ||
    ((s, n) =>
      // Prefer whole graphemes under UTF-16 budget (emoji ZWJ, flags, etc.)
      truncateGraphemesToUtf16Budget(String(s || ""), n, "…"));
  const onEdit = opts.onEdit;

  let messageId = null;
  let lastEditAt = 0;
  let lastText = "";
  let pendingText = null;
  let timer = null;
  let closed = false;
  let toolLines = [];

  function clip(text) {
    return truncate(String(text || "").trim() || "…", maxLen);
  }

  async function sendPlaceholder() {
    if (messageId != null || closed) return messageId;
    const msg = await api("sendMessage", {
      chat_id: chatId,
      text: "…",
      reply_to_message_id: replyTo,
      disable_web_page_preview: true,
    });
    messageId = msg?.message_id ?? msg?.messageId ?? null;
    lastText = "…";
    lastEditAt = Date.now();
    return messageId;
  }

  async function editNow(text) {
    if (closed) return;
    const body = clip(text);
    if (messageId == null) {
      await sendPlaceholder();
    }
    if (messageId == null) return;
    if (body === lastText) return;
    try {
      await api("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: body,
        disable_web_page_preview: true,
      });
      lastText = body;
      lastEditAt = Date.now();
      try {
        onEdit?.({ ok: true });
      } catch {
        /* */
      }
    } catch (err) {
      const msg = String(err?.message || err);
      // Telegram returns 400 when content is unchanged
      if (/not modified/i.test(msg)) {
        lastText = body;
        try {
          onEdit?.({ ok: true, notModified: true });
        } catch {
          /* */
        }
        return;
      }
      // Message too old / can't edit — fall back to new message once
      if (/can't be edited|message to edit not found/i.test(msg)) {
        try {
          const msg2 = await api("sendMessage", {
            chat_id: chatId,
            text: body,
            disable_web_page_preview: true,
          });
          messageId = msg2?.message_id ?? messageId;
          lastText = body;
          lastEditAt = Date.now();
        } catch {
          /* ignore */
        }
        return;
      }
      throw err;
    }
  }

  function schedule(text) {
    pendingText = text;
    if (timer) return;
    const wait = Math.max(0, minEditIntervalMs - (Date.now() - lastEditAt));
    timer = setTimeout(async () => {
      timer = null;
      const next = pendingText;
      pendingText = null;
      if (next != null && !closed) {
        try {
          await editNow(next);
        } catch {
          /* swallow mid-stream edit errors */
        }
        if (pendingText != null) schedule(pendingText);
      }
    }, wait);
    if (typeof timer.unref === "function") timer.unref();
  }

  /**
   * Update status line (tools / phase). Throttled.
   * @param {string} text
   * @param {{ force?: boolean }} [opt]
   */
  async function update(text, opt = {}) {
    if (closed) return;
    if (opt.force) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pendingText = null;
      await editNow(text);
      return;
    }
    schedule(text);
  }

  /**
   * Record tool start for a compact status message.
   * @param {string} name
   */
  async function onToolStart(name) {
    const n = String(name || "tool");
    toolLines.push(`→ ${n}`);
    if (toolLines.length > 8) toolLines = toolLines.slice(-8);
    await update(["Working…", ...toolLines].join("\n"));
  }

  /**
   * Growing assistant text (token stream). Throttled like update().
   * @param {string} accumulated
   */
  async function setPartial(accumulated) {
    if (closed) return;
    const text = String(accumulated || "").trim();
    if (!text) return;
    await update(text);
  }

  /**
   * Final answer — forces edit (or placeholder create).
   * @param {string} text
   */
  /**
   * Final answer — edit first chunk; send overflow as follow-up messages.
   * @param {string} text
   * @returns {Promise<{ messageId: any, overflowSent: number }>}
   */
  async function finish(text) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pendingText = null;
    const raw = String(text || "").trim() || "(no response)";
    const { head, overflow } = splitHeadAndOverflow(raw, maxLen);

    try {
      await editNow(head);
    } catch (err) {
      // Last resort: send head as new message
      try {
        const msg = await api("sendMessage", {
          chat_id: chatId,
          text: clip(head),
          reply_to_message_id: messageId == null ? replyTo : undefined,
          disable_web_page_preview: true,
        });
        messageId = msg?.message_id ?? messageId;
      } catch {
        throw err;
      }
    }

    let overflowSent = 0;
    for (const part of overflow) {
      if (!part || closed) break;
      try {
        await api("sendMessage", {
          chat_id: chatId,
          text: part.length > maxLen ? clip(part) : part,
          disable_web_page_preview: true,
        });
        overflowSent += 1;
      } catch (err) {
        // stop spilling on hard failure; head already delivered
        try {
          onEdit?.({ ok: false, overflow: true, error: String(err?.message || err) });
        } catch {
          /* */
        }
        break;
      }
    }
    return { messageId, overflowSent };
  }

  function close() {
    closed = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pendingText = null;
  }

  return {
    sendPlaceholder,
    update,
    setPartial,
    onToolStart,
    finish,
    close,
    getMessageId: () => messageId,
    getLastText: () => lastText,
  };
}

/**
 * @param {object} conf channels.telegram
 */
export function isTelegramStreamEnabled(conf = {}) {
  if (conf.stream === false) return false;
  if (conf.stream === true) return true;
  if (conf.stream && typeof conf.stream === "object") {
    if (conf.stream.enabled === false) return false;
  }
  // Default on when channel is enabled
  return true;
}

export function telegramStreamOptions(conf = {}) {
  const s = conf.stream && typeof conf.stream === "object" ? conf.stream : {};
  return {
    enabled: isTelegramStreamEnabled(conf),
    minEditIntervalMs: Number(s.minEditIntervalMs) > 0 ? Number(s.minEditIntervalMs) : 1200,
    showTools: s.showTools !== false,
    /** Token/partial text edits (requires agent stream) */
    partialText: s.partialText !== false,
  };
}

export default {
  createTelegramStreamer,
  isTelegramStreamEnabled,
  telegramStreamOptions,
};
