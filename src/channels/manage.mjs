/**
 * Channel management core — the shared model behind `xclaw channels …` (CLI/TUI)
 * and the gateway `/channels/manage/*` routes + control-UI panel. Mirrors
 * providers/manage.mjs so all three surfaces behave identically.
 *
 * Unlike provider credentials (which live in the auth-profile store), channel
 * secrets live inline in cfg.channels.<id> by existing design — the config file
 * is chmod 600. This module NEVER returns secret values: the inventory reports
 * booleans (set / not-set) only. Writes go through saveConfigPatch.
 */
import { saveConfigPatch } from "../config/load.mjs";

/**
 * Declarative field specs per channel. `secret` fields are redacted in the
 * inventory (only a boolean is reported). `required` fields (the secrets a
 * channel needs to function) drive the `configured` flag. Nested config uses
 * dot-paths (email.imap.pass) resolved against cfg.channels.<id>.
 */
export const CHANNEL_SPECS = {
  telegram: {
    name: "Telegram",
    fields: [
      { key: "token", label: "Bot token", secret: true, required: true },
      { key: "ownerChatId", label: "Owner chat id" },
      { key: "allowedChatIds", label: "Allowed chat ids (comma list)", type: "list" },
      { key: "transport", label: "Transport (poll|webhook)" },
    ],
  },
  slack: {
    name: "Slack",
    fields: [
      { key: "botToken", label: "Bot token (xoxb-)", secret: true, required: true },
      { key: "appToken", label: "App token (xapp-, socket mode)", secret: true },
      { key: "socketMode", label: "Socket mode", type: "bool" },
      { key: "channelIds", label: "Channel ids (comma list)", type: "list" },
    ],
  },
  discord: {
    name: "Discord",
    fields: [
      { key: "token", label: "Bot token", secret: true, required: true },
      { key: "allowedChannelIds", label: "Allowed channel ids (comma list)", type: "list" },
    ],
  },
  email: {
    name: "Email (IMAP/SMTP)",
    fields: [
      { key: "imap.host", label: "IMAP host", required: true },
      { key: "imap.user", label: "IMAP user", required: true },
      { key: "imap.pass", label: "IMAP password", secret: true, required: true },
      { key: "smtp.host", label: "SMTP host" },
      { key: "smtp.user", label: "SMTP user" },
      { key: "smtp.pass", label: "SMTP password", secret: true },
      { key: "smtp.from", label: "From address" },
    ],
  },
  webchat: {
    name: "WebChat",
    fields: [],
    note: "Built-in browser chat at /chat/ — no credentials; enable/disable only.",
  },
};

export function channelIds() {
  return Object.keys(CHANNEL_SPECS);
}

/** Read a dot-path value from an object. */
function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Build a nested patch object from a dot-path + value. */
function patchPath(path, value) {
  const parts = path.split(".");
  const root = {};
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return root;
}

/**
 * Inventory of every channel — enabled, configured, and per-field status with
 * secrets redacted to booleans. @returns {{ channels: object[] }}
 */
export function channelInventory(cfg = {}) {
  const chcfg = cfg.channels || {};
  const channels = channelIds().map((id) => {
    const spec = CHANNEL_SPECS[id];
    const conf = chcfg[id] || {};
    const fields = spec.fields.map((f) => {
      const val = getPath(conf, f.key);
      const hasVal = val != null && val !== "" && !(Array.isArray(val) && val.length === 0);
      return {
        key: f.key,
        label: f.label,
        secret: Boolean(f.secret),
        required: Boolean(f.required),
        type: f.type || "string",
        // secrets never leave as values — only set/not-set
        set: hasVal,
        value: f.secret ? undefined : hasVal ? val : undefined,
      };
    });
    const requiredMet = spec.fields
      .filter((f) => f.required)
      .every((f) => fields.find((x) => x.key === f.key)?.set);
    return {
      id,
      name: spec.name,
      enabled: conf.enabled === true || (id === "webchat" && conf.enabled !== false),
      configured: id === "webchat" ? true : requiredMet,
      note: spec.note || null,
      fields,
    };
  });
  return { channels };
}

/** Validate a channel id + optional field key. */
function assertChannel(id, key) {
  const spec = CHANNEL_SPECS[id];
  if (!spec) throw new Error(`unknown channel: ${id} (known: ${channelIds().join(", ")})`);
  if (key && !spec.fields.find((f) => f.key === key)) {
    throw new Error(`unknown field '${key}' for ${id} (fields: ${spec.fields.map((f) => f.key).join(", ") || "none"})`);
  }
}

/** Coerce a string CLI value to the field's type. */
function coerce(spec, key, raw) {
  const f = spec.fields.find((x) => x.key === key);
  if (!f) return raw;
  if (raw == null) return null;
  if (f.type === "bool") return raw === true || /^(1|true|yes|on)$/i.test(String(raw));
  if (f.type === "list") {
    if (Array.isArray(raw)) return raw;
    const s = String(raw).trim();
    return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
  }
  return raw;
}

/** Set one channel field (secret or plain). value=null clears it. */
export async function setChannelField(id, key, value) {
  assertChannel(id, key);
  const spec = CHANNEL_SPECS[id];
  const coerced = value === null ? null : coerce(spec, key, value);
  await saveConfigPatch({ channels: { [id]: patchPath(key, coerced) } });
  return { ok: true, channel: id, key, secret: Boolean(spec.fields.find((f) => f.key === key)?.secret) };
}

/** Enable/disable a channel. */
export async function setChannelEnabled(id, enabled) {
  assertChannel(id);
  await saveConfigPatch({ channels: { [id]: { enabled: Boolean(enabled) } } });
  return { ok: true, channel: id, enabled: Boolean(enabled) };
}

/** Merge live manager status (from the gateway) into an inventory. */
export function mergeStatus(inv, statusMap = {}) {
  for (const ch of inv.channels) {
    const st = statusMap[ch.id];
    if (st) ch.status = st;
  }
  return inv;
}

export default {
  CHANNEL_SPECS,
  channelIds,
  channelInventory,
  setChannelField,
  setChannelEnabled,
  mergeStatus,
};
