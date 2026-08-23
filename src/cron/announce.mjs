/**
 * Cron announce delivery — run agent and route reply to session/channel.
 */
import { runAgentLoop } from "../agent/loop.mjs";
import { getSessionByKey, getSession, resolveBinding } from "../sessions/router.mjs";
import { parseSessionKey } from "../sessions/session-key.mjs";
import { deliverToChannel } from "./channel-deliver.mjs";

/**
 * Execute a cron job payload via agent and return delivery target + text.
 */
export async function announceCronJob(job, opts = {}) {
  const cfg = opts.cfg || {};
  const prompt =
    job.payload?.message ||
    job.payload?.text ||
    job.payload?.prompt ||
    `Cron job "${job.name}" fired. Summarize status briefly.`;

  const sessionKey = job.sessionKey || job.delivery?.sessionKey;
  let session = sessionKey ? getSessionByKey(sessionKey) : null;
  if (!session && job.delivery?.channel && job.delivery?.to) {
    session = resolveBinding(
      job.delivery.channel,
      String(job.delivery.to),
      job.delivery.threadId ? "group" : "dm"
    );
  }

  const result = await runAgentLoop({
    // Bounded utility run — never auto-continue.
    continuation: false,
    userMessage: prompt,
    cfg,
    workingDir: session?.workingDir || opts.workingDir || process.cwd(),
    signal: opts.signal,
    onEvent: opts.onEvent,
  });

  const delivery = {
    mode: job.delivery?.mode || "announce",
    channel: job.delivery?.channel || session?.channel || null,
    to: job.delivery?.to || session?.peerId || null,
    sessionKey: session?.sessionKey || sessionKey || null,
    sessionId: session?.id || null,
    text: result.text,
    turns: result.turns,
    model: result.model,
  };

  let sendResult = null;
  if (delivery.mode === "announce") {
    if (typeof opts.deliver === "function") {
      sendResult = await opts.deliver(delivery);
    } else {
      sendResult = await deliverToChannel(delivery, cfg);
    }
  }

  return { ok: true, delivery, result, sendResult };
}
