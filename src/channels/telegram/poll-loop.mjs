/**
 * Robust Telegram getUpdates polling loop (P4+).
 *
 * Handles: 409 conflict (clear webhook), 429 Retry-After, network backoff,
 * empty batches, writer-lock heartbeat, graceful stop.
 *
 * Dispatch policy (the approval-deadlock fix): the loop must NEVER be blocked
 * by a long-running agent turn. With the original `await onUpdate(u)` a turn
 * pending human approval (up to 120s) froze the loop, so the owner's
 * `/approve` — or the inline Allow callback — could not even be READ until
 * the SLA had already denied the approval (`Failed: unknown_pending`, live
 * incident 2026-08-13). Now:
 *   - callback_query updates and slash-command messages ("/approve", …) are
 *     handled inline (they are fast — no LLM) so they can overtake a
 *     blocked turn;
 *   - everything else is dispatched to a per-chat serial queue: ordering
 *     within a chat is preserved, but the loop returns to getUpdates
 *     immediately.
 */
import {
  classifyTelegramError,
  backoffMsFromClassification,
} from "./errors.mjs";

/** Commands and button callbacks must be able to overtake a blocked turn. */
export function isFastLaneUpdate(u) {
  if (u?.callback_query) return true;
  const msg = u?.message || u?.edited_message;
  const text = msg?.text ?? msg?.caption ?? "";
  return typeof text === "string" && text.trim().startsWith("/");
}

/**
 * @param {object} opts
 * @param {(method: string, body?: object) => Promise<any>} opts.api
 * @param {() => boolean} opts.isStopped
 * @param {(update: object) => Promise<void>} opts.onUpdate
 * @param {object} [opts.conf] channels.telegram
 * @param {(info: object) => void} [opts.onError]
 * @param {() => void} [opts.onPollOk] — fires after every successful getUpdates
 *   (empty batches included). This is the channel's true liveness signal:
 *   messagesHandled is useless for a quiet DM bot.
 * @param {() => void} [opts.onTouchLock]
 * @param {(offset: number) => void} [opts.onOffset]
 * @param {() => number} [opts.getOffset]
 * @param {(v: number) => void} [opts.setOffset]
 * @param {string} [opts.botUsername]
 */
export async function runTelegramPollLoop(opts) {
  const {
    api,
    isStopped,
    onUpdate,
    conf = {},
    onError,
    onPollOk,
    onTouchLock,
    getOffset,
    setOffset,
    botUsername,
  } = opts;

  const timeoutSec = Math.min(
    50,
    Math.max(1, Number(conf.pollTimeoutSec ?? conf.poll?.timeoutSec) || 30)
  );
  const limit = Math.min(
    100,
    Math.max(1, Number(conf.pollLimit ?? conf.poll?.limit) || 100)
  );
  const allowed =
    conf.pollAllowedUpdates ||
    conf.poll?.allowedUpdates || [
      "message",
      "edited_message",
      "callback_query",
    ];

  let attempt = 0;
  let consecutiveEmpty = 0;
  /** chatId → tail of that chat's serial dispatch chain */
  const chatQueues = new Map();

  function dispatchQueued(u) {
    const msg = u?.message || u?.edited_message;
    const chatId = String(msg?.chat?.id ?? "global");
    const prev = chatQueues.get(chatId) || Promise.resolve();
    const next = prev
      .then(() => onUpdate(u))
      .catch((err) => {
        const c = classifyTelegramError(err);
        onError?.({ phase: "update", ...c, err });
        console.error(`[telegram] update error:`, c.message);
      });
    chatQueues.set(chatId, next);
    next.finally(() => {
      if (chatQueues.get(chatId) === next) chatQueues.delete(chatId);
    });
  }

  console.log(
    `[telegram] long-poll starting (@${botUsername || "?"}) timeout=${timeoutSec}s limit=${limit}`
  );

  while (!isStopped()) {
    try {
      onTouchLock?.();
      const offset = getOffset?.() ?? 0;
      const updates = await api("getUpdates", {
        offset,
        timeout: timeoutSec,
        limit,
        allowed_updates: allowed,
      });

      attempt = 0;
      try {
        onPollOk?.();
      } catch {
        /* liveness reporting must never break the loop */
      }
      if (!Array.isArray(updates) || updates.length === 0) {
        consecutiveEmpty += 1;
        continue;
      }
      consecutiveEmpty = 0;

      for (const u of updates) {
        if (isStopped()) break;
        if (u?.update_id != null) {
          setOffset?.(Number(u.update_id) + 1);
        }
        if (isFastLaneUpdate(u)) {
          // Inline await is safe here: commands/callbacks never run the LLM.
          try {
            await onUpdate(u);
          } catch (err) {
            const c = classifyTelegramError(err);
            onError?.({ phase: "update", ...c, err });
            console.error(`[telegram] update error:`, c.message);
          }
        } else {
          dispatchQueued(u);
        }
      }
    } catch (err) {
      if (isStopped()) break;
      const c = classifyTelegramError(err);
      onError?.({ phase: "poll", ...c, err });
      console.error(`[telegram] poll error:`, c.message);

      if (c.code === "CONFLICT") {
        try {
          await api("deleteWebhook", { drop_pending_updates: false });
          console.warn(`[telegram] cleared webhook after getUpdates conflict`);
        } catch (e2) {
          console.warn(`[telegram] deleteWebhook failed:`, e2.message || e2);
        }
      }

      if (c.code === "UNAUTHORIZED") {
        console.error(`[telegram] fatal: invalid token — stopping poll`);
        break;
      }

      const delay = backoffMsFromClassification(c, attempt);
      attempt += 1;
      console.warn(
        `[telegram] backoff ${delay}ms (attempt ${attempt}, code=${c.code})`
      );
      await sleep(delay, isStopped);
    }
  }

  console.log(
    `[telegram] stopped (emptyBatches=${consecutiveEmpty})`
  );
}

function sleep(ms, isStopped) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === "function") t.unref();
    // early wake not required; stop is checked at loop head
    if (isStopped?.()) {
      clearTimeout(t);
      resolve();
    }
  });
}

export default { runTelegramPollLoop };
