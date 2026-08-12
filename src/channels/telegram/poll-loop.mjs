/**
 * Robust Telegram getUpdates polling loop (P4+).
 *
 * Handles: 409 conflict (clear webhook), 429 Retry-After, network backoff,
 * empty batches, writer-lock heartbeat, graceful stop.
 */
import {
  classifyTelegramError,
  backoffMsFromClassification,
} from "./errors.mjs";

/**
 * @param {object} opts
 * @param {(method: string, body?: object) => Promise<any>} opts.api
 * @param {() => boolean} opts.isStopped
 * @param {(update: object) => Promise<void>} opts.onUpdate
 * @param {object} [opts.conf] channels.telegram
 * @param {(info: object) => void} [opts.onError]
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
        try {
          await onUpdate(u);
        } catch (err) {
          const c = classifyTelegramError(err);
          onError?.({ phase: "update", ...c, err });
          console.error(`[telegram] update error:`, c.message);
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
