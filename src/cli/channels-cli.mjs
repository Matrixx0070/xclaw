/**
 * xclaw channels — configure every messaging channel (Telegram, Slack, Discord,
 * Email, WebChat) independently and enable/disable them. Mirrors the providers
 * CLI/TUI so all three surfaces (CLI, TUI, control-UI panel) behave identically.
 *
 * Channel secrets live inline in cfg.channels.<id> by existing design (the
 * config file is chmod 600); writes go through src/channels/manage.mjs, which
 * NEVER echoes secret values back — the table reports set / not-set only.
 *
 * Subcommands:
 *   channels [list]                              table of every channel + status
 *   channels set --channel X --field K --value V configure one field (--clear nulls it)
 *   channels enable X | disable X                toggle a channel on/off
 *   channels setup                               sequential wizard over ALL channels
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "../config/load.mjs";
import {
  CHANNEL_SPECS,
  channelIds,
  channelInventory,
  setChannelField,
  setChannelEnabled,
} from "../channels/manage.mjs";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
};
const color = (on) => (code, s) => (on ? `${code}${s}${ANSI.reset}` : s);

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

const NON_TTY_MSG =
  "Interactive mode needs a terminal. Run in an interactive terminal, or use `xclaw channels set --channel X --field K --value V` / `xclaw channels enable X`.";

/** Column widths (visible chars). Padding is applied on PLAIN text so ANSI
 *  colour codes never throw off alignment (mirrors providers-cli). */
const COL = { id: 12, enabled: 9, status: 14 };

/** Pad a cell to `width` by the PLAIN text length, keeping any ANSI wrapper. */
function padCell(plain, width, colored) {
  return (colored ?? plain) + " ".repeat(Math.max(1, width - String(plain).length));
}

/** Compact per-field summary: secrets → `token=set`, plain → `transport=poll`. */
function fieldSummary(ch) {
  const set = ch.fields.filter((f) => f.set);
  if (!set.length) return ch.note ? "" : "(nothing set)";
  return set
    .map((f) => {
      if (f.secret) return `${f.key}=set`;
      const v = Array.isArray(f.value) ? f.value.join(",") : String(f.value);
      return `${f.key}=${v.length > 24 ? v.slice(0, 23) + "…" : v}`;
    })
    .join("  ");
}

/**
 * Render the channel table (pure — returns lines, used by list + tests).
 * Enabled channels first, then disabled — what's live is up top.
 */
export function renderChannelTable(inv, { ansi = true } = {}) {
  const c = color(ansi);
  const lines = [];
  lines.push(
    c(
      ANSI.bold,
      "  " +
        "CHANNEL".padEnd(COL.id) +
        "ENABLED".padEnd(COL.enabled) +
        "STATUS".padEnd(COL.status) +
        "FIELDS"
    )
  );

  const renderRow = (ch, { dim = false } = {}) => {
    const d = (s) => (dim ? c(ANSI.dim, s) : s);
    const onPlain = ch.enabled ? "on" : "off";
    const on = ch.enabled ? c(ANSI.green, "● on") : d("○ off");
    const statusPlain = ch.configured ? "ready" : "needs setup";
    const status = ch.configured ? c(ANSI.green, "ready") : c(ANSI.yellow, "needs setup");
    const row =
      "  " +
      padCell(ch.id, COL.id, d(ch.id)) +
      padCell(onPlain, COL.enabled, on) +
      padCell(statusPlain, COL.status, status) +
      d(fieldSummary(ch));
    lines.push(row);
    if (ch.note) lines.push(c(ANSI.dim, `    ↳ ${ch.note}`));
  };

  const on = inv.channels.filter((ch) => ch.enabled);
  const off = inv.channels.filter((ch) => !ch.enabled);
  for (const ch of on) renderRow(ch);
  if (off.length) {
    if (on.length) lines.push(c(ANSI.dim, "  — disabled —"));
    for (const ch of off) renderRow(ch, { dim: true });
  }

  lines.push("");
  lines.push(
    c(
      ANSI.dim,
      `  ${on.length}/${inv.channels.length} enabled · secrets stored in the config file (chmod 600) · "xclaw channels setup" to configure`
    )
  );
  return lines;
}

async function cmdList() {
  const cfg = await loadConfig();
  const inv = channelInventory(cfg);
  for (const line of renderChannelTable(inv, { ansi: Boolean(process.stdout.isTTY) })) {
    console.log(line);
  }
  return 0;
}

async function cmdSet(args) {
  const channel = flag(args, "--channel") || args[1];
  const field = flag(args, "--field");
  const clear = args.includes("--clear");
  let value = flag(args, "--value");
  if (clear) value = null;
  if (!channel || channel.startsWith("--")) {
    console.error("Usage: xclaw channels set --channel X --field KEY --value V   (or --clear)");
    return 1;
  }
  if (!channelIds().includes(channel)) {
    console.error(`Unknown channel: ${channel} (known: ${channelIds().join(", ")})`);
    return 1;
  }
  if (!field) {
    const spec = CHANNEL_SPECS[channel];
    console.error(
      `--field required. ${channel} fields: ${spec.fields.map((f) => f.key).join(", ") || "(none — enable/disable only)"}`
    );
    return 1;
  }
  if (!clear && value === undefined) {
    console.error("Pass --value V (or --clear to unset).");
    return 1;
  }
  try {
    const r = await setChannelField(channel, field, value);
    if (clear) console.log(`${channel}.${field} cleared`);
    else if (r.secret) console.log(`${channel}.${field} stored (secret — not echoed)`);
    else console.log(`${channel}.${field} → ${value}`);
    return 0;
  } catch (e) {
    console.error(e.message || String(e));
    return 1;
  }
}

async function cmdToggle(args, enabled) {
  const channel = args[1];
  if (!channel || channel.startsWith("--")) {
    console.error(`Usage: xclaw channels ${enabled ? "enable" : "disable"} <channel>`);
    return 1;
  }
  if (!channelIds().includes(channel)) {
    console.error(`Unknown channel: ${channel} (known: ${channelIds().join(", ")})`);
    return 1;
  }
  try {
    await setChannelEnabled(channel, enabled);
    // Warn if enabling a channel whose required secrets aren't set yet.
    if (enabled) {
      const inv = channelInventory(await loadConfig());
      const ch = inv.channels.find((x) => x.id === channel);
      if (ch && !ch.configured) {
        console.log(`${channel} enabled — but not configured yet; set its fields with \`xclaw channels set --channel ${channel} --field ...\` (or \`channels setup\`).`);
        return 0;
      }
    }
    console.log(`${channel} ${enabled ? "enabled" : "disabled"}`);
    return 0;
  } catch (e) {
    console.error(e.message || String(e));
    return 1;
  }
}

/**
 * Sequential wizard over every channel: enable/disable + prompt each field.
 * Secret fields are typed in cleartext (stdin isn't hidden — same as the
 * providers key/oauth paste flow); we warn before prompting.
 */
async function cmdSetup() {
  if (!isInteractive()) {
    console.error(NON_TTY_MSG);
    return 1;
  }
  const rl = readline.createInterface({ input, output });
  try {
    console.log("\nXClaw channel setup — walks every channel; all steps optional, re-runnable.");
    console.log("Note: secrets you type are visible in the terminal (stdin is not masked).");
    let skipAll = false;
    for (const id of channelIds()) {
      if (skipAll) break;
      const spec = CHANNEL_SPECS[id];
      const inv = channelInventory(await loadConfig());
      const ch = inv.channels.find((x) => x.id === id);
      console.log(
        `\n─── ${id} (${spec.name}) — ${ch.enabled ? "enabled" : "disabled"}, ${ch.configured ? "ready" : "needs setup"}`
      );
      if (ch.note) console.log(`    ${ch.note}`);
      console.log(
        "    [1] skip   [2] " +
          (ch.enabled ? "disable" : "enable") +
          (spec.fields.length ? "   [3] set fields" : "") +
          "   [s] skip all   [q] quit"
      );
      let handled = false;
      while (!handled) {
        const ans = (await rl.question("> ")).trim().toLowerCase();
        handled = true;
        if (ans === "" || ans === "1") break;
        if (ans === "q" || ans === "quit") return 0;
        if (ans === "s") {
          skipAll = true;
          break;
        }
        if (ans === "2") {
          await setChannelEnabled(id, !ch.enabled);
          console.log(`  ${id} ${!ch.enabled ? "enabled" : "disabled"}.`);
          break;
        }
        if (ans === "3" && spec.fields.length) {
          for (const f of spec.fields) {
            const cur = ch.fields.find((x) => x.key === f.key);
            const shown = cur?.set ? (f.secret ? "set" : cur.value) : "unset";
            const prompt = `  ${f.label}${f.required ? " (required)" : ""} [${shown}] — value (blank keeps, '-' clears): `;
            const v = (await rl.question(prompt)).trim();
            if (v === "") continue;
            await setChannelField(id, f.key, v === "-" ? null : v);
            console.log(`    ${f.key} ${v === "-" ? "cleared" : f.secret ? "stored (secret)" : "→ " + v}`);
          }
          // Offer to enable now that fields are set.
          if (!ch.enabled) {
            const en = (await rl.question(`  Enable ${id} now? [Y/n] `)).trim().toLowerCase();
            if (en !== "n" && en !== "no") {
              await setChannelEnabled(id, true);
              console.log(`  ${id} enabled.`);
            }
          }
          break;
        }
        handled = false;
        console.log(`  enter 1-${spec.fields.length ? "3" : "2"}, s, or q`);
      }
    }
    console.log("\nDone. `xclaw channels` to review, `xclaw gateway` to start them.");
    return 0;
  } finally {
    try {
      rl.close();
    } catch {
      /* already closed */
    }
  }
}

const USAGE = `Usage:
  xclaw channels [list]                              table: enabled / status / fields per channel
  xclaw channels set --channel X --field K --value V configure one field (--clear to unset)
  xclaw channels enable X | disable X                toggle a channel on/off
  xclaw channels setup                               sequential wizard across every channel

Channels: ${channelIds().join(", ")}. Secrets are stored inline in the config
file (chmod 600) and never echoed back. Start configured channels with \`xclaw gateway\`.`;

export async function runChannelsCli(args = [], _ctx = {}) {
  const sub = args[0] || "list";
  let code = 1;
  if (sub === "list") code = await cmdList();
  else if (sub === "set") code = await cmdSet(args);
  else if (sub === "enable") code = await cmdToggle(args, true);
  else if (sub === "disable") code = await cmdToggle(args, false);
  else if (sub === "setup") code = await cmdSetup();
  else {
    console.error(USAGE);
    code = sub === "help" ? 0 : 1;
  }
  process.exitCode = code;
  return code;
}

export default { runChannelsCli, renderChannelTable };
