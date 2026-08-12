/**
 * Deliver cron announce results to messaging channels.
 */
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
  const channel = delivery.channel;
  const to = delivery.to;
  const text = truncate(delivery.text || "", 4000);
  if (!channel || !to || !text) {
    return { ok: false, reason: "missing_fields", delivery };
  }

  if (channel === "telegram") {
    const token =
      cfg.channels?.telegram?.token ||
      process.env.TELEGRAM_BOT_TOKEN ||
      process.env.XCLAW_TELEGRAM_TOKEN;
    if (!token) return { ok: false, reason: "no_telegram_token" };
    const r = await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: to,
        text,
        disable_web_page_preview: true,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) {
      return { ok: false, reason: j.description || r.status };
    }
    return { ok: true, channel, to, messageId: j.result?.message_id };
  }

  if (channel === "discord") {
    const token =
      cfg.channels?.discord?.token ||
      process.env.DISCORD_BOT_TOKEN ||
      process.env.XCLAW_DISCORD_TOKEN;
    if (!token) return { ok: false, reason: "no_discord_token" };
    // `to` may be channel id
    const r = await fetch(`${DISCORD_REST}/channels/${to}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: truncate(text, 2000) }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return { ok: false, reason: j.message || r.status };
    }
    const j = await r.json();
    return { ok: true, channel, to, messageId: j.id };
  }

  return { ok: false, reason: `unsupported_channel:${channel}` };
}
