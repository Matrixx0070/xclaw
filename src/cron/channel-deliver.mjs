/**
 * Deliver cron announce results to messaging channels.
 */
import { fetchWithRetry } from "../utils/fetch-retry.mjs";

const TG_API = "https://api.telegram.org";
const DISCORD_REST = "https://discord.com/api/v10";

function truncate(s, n) {
  const t = String(s || "");
  return t.length <= n ? t : t.slice(0, n - 20) + "\n…(truncated)";
}

export async function deliverToChannel(delivery, cfg = {}) {
  if (!delivery || delivery.mode === "none") {
    return { ok: false, reason: "no_delivery" };
  }
  const channel = String(delivery.channel || "").toLowerCase();
  const to = delivery.to;
  const text = truncate(delivery.text || delivery.message || "", 3500);
  if (!to || !text) return { ok: false, reason: "missing_to_or_text" };

  if (channel === "telegram" || channel === "tg") {
    const token =
      cfg.channels?.telegram?.botToken ||
      process.env.TELEGRAM_BOT_TOKEN ||
      process.env.XCLAW_TELEGRAM_BOT_TOKEN;
    if (!token) return { ok: false, reason: "no_telegram_token" };
    const r = await fetchWithRetry(`${TG_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: to,
        text,
        disable_web_page_preview: true,
      }),
      retries: 3,
      baseMs: 300,
      maxDelayMs: 10_000,
      timeoutMs: 20_000,
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.ok === false) {
      return {
        ok: false,
        reason: body.description || `http_${r.status}`,
        status: r.status,
      };
    }
    return { ok: true, channel: "telegram", id: body.result?.message_id };
  }

  if (channel === "discord") {
    const token =
      cfg.channels?.discord?.botToken ||
      process.env.DISCORD_BOT_TOKEN ||
      process.env.XCLAW_DISCORD_BOT_TOKEN;
    if (!token) return { ok: false, reason: "no_discord_token" };
    const r = await fetchWithRetry(`${DISCORD_REST}/channels/${to}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${token}`,
      },
      body: JSON.stringify({ content: text.slice(0, 2000) }),
      retries: 3,
      baseMs: 300,
      maxDelayMs: 10_000,
      timeoutMs: 20_000,
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return { ok: false, reason: errText || `http_${r.status}`, status: r.status };
    }
    const body = await r.json().catch(() => ({}));
    return { ok: true, channel: "discord", id: body.id };
  }

  if (channel === "slack") {
    const token =
      cfg.channels?.slack?.botToken ||
      process.env.SLACK_BOT_TOKEN ||
      process.env.XCLAW_SLACK_BOT_TOKEN;
    if (!token) return { ok: false, reason: "no_slack_token" };
    const r = await fetchWithRetry("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel: to, text }),
      retries: 3,
      baseMs: 300,
      maxDelayMs: 10_000,
      timeoutMs: 20_000,
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.ok === false) {
      return {
        ok: false,
        reason: body.error || `http_${r.status}`,
        status: r.status,
      };
    }
    return { ok: true, channel: "slack", id: body.ts };
  }

  return { ok: false, reason: `unsupported_channel:${channel || "none"}` };
}

export default { deliverToChannel };
