/**
 * Gateway channel-management HTTP routes (control-plane for the shared core in
 * src/channels/manage.mjs — same behavior as `xclaw channels …`). Mirrors
 * routes/providers.mjs.
 *
 * Paths (namespaced under /channels/manage so the GET /channels/status read in
 * routes/ops.mjs is untouched):
 *   GET  /channels/manage          → inventory (secrets redacted to booleans) +
 *                                    live run-status when a channelManager exists
 *   POST /channels/manage/field    → {channel, key, value|null} set/clear a field
 *   POST /channels/manage/enabled  → {channel, enabled} enable/disable
 *   POST /channels/manage/restart  → {channel} restart a live channel (or note)
 *
 * Channel secrets live inline in cfg.channels.<id> (config is chmod 600); this
 * route never echoes a secret value back.
 */
import {
  channelInventory,
  setChannelField,
  setChannelEnabled,
  mergeStatus,
} from "../../channels/manage.mjs";

const APPLIES_NOTE = "applies on next gateway start / channel restart";

/**
 * @param {object} args — standard route args + live channelManager
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleChannelsRoute({ p, method, req, res, cfg, json, readBody, channelManager }) {
  if (!p.startsWith("/channels/manage")) return false;

  try {
    if (p === "/channels/manage" && method === "GET") {
      const inv = channelInventory(cfg);
      let statusMap = null;
      try {
        statusMap = channelManager?.status?.() || null;
      } catch {
        statusMap = null;
      }
      if (statusMap) mergeStatus(inv, statusMap);
      json(res, 200, inv);
      return true;
    }

    if (p === "/channels/manage/field" && method === "POST") {
      const body = await readBody(req);
      if (!body.channel || !body.key) {
        json(res, 400, { error: "channel and key required" });
        return true;
      }
      const out = await setChannelField(body.channel, body.key, body.value ?? null);
      // Never echo the value back.
      json(res, 200, { ok: out.ok, channel: out.channel, key: out.key, secret: out.secret, note: APPLIES_NOTE });
      return true;
    }

    if (p === "/channels/manage/enabled" && method === "POST") {
      const body = await readBody(req);
      if (!body.channel || typeof body.enabled !== "boolean") {
        json(res, 400, { error: "channel and enabled (boolean) required" });
        return true;
      }
      const out = await setChannelEnabled(body.channel, body.enabled);
      json(res, 200, { ...out, note: APPLIES_NOTE });
      return true;
    }

    if (p === "/channels/manage/restart" && method === "POST") {
      const body = await readBody(req);
      if (!body.channel) {
        json(res, 400, { error: "channel required" });
        return true;
      }
      if (channelManager?.restartChannel) {
        try {
          await channelManager.restartChannel(body.channel);
          json(res, 200, { ok: true, channel: body.channel, restarted: true });
        } catch (e) {
          json(res, 200, { ok: false, channel: body.channel, error: e?.message || String(e) });
        }
        return true;
      }
      json(res, 200, { ok: false, channel: body.channel, note: "no live channel manager — restart on gateway reload" });
      return true;
    }
  } catch (err) {
    json(res, 400, { error: err?.message || String(err) });
    return true;
  }

  return false;
}

export default { tryHandleChannelsRoute };
