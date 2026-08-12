/**
 * Discord channel — Bot Gateway (WebSocket) + REST send
 *
 * Config (cfg.channels.discord):
 *   enabled: boolean
 *   token: string           (or env DISCORD_BOT_TOKEN)
 *   allowedChannelIds: string[] | null
 *   workingDir?: string
 *
 * Requires Message Content Intent enabled for the bot in Discord Developer Portal.
 */
import { replyWithAgent, truncate } from "../base.mjs";
import { processInbound, fromDiscordMessage } from "../runtime.mjs";
import { createChannelPolicy } from "../policy.mjs";
import { resolveBinding, touchSession } from "../../sessions/router.mjs";
import {
  createPairingStore,
  buildPairingReply,
} from "../../pairing/pairing-store.mjs";
import { createRateLimiter } from "../rate-limit.mjs";
import { handleChannelCommand } from "../commands.mjs";

const REST = "https://discord.com/api/v10";
const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
// Guild messages + DM + Message Content
const INTENTS = (1 << 0) | (1 << 9) | (1 << 15) | (1 << 12);

export function createDiscordChannel(cfg) {
  const conf = cfg.channels?.discord || {};
  const token = conf.token || process.env.DISCORD_BOT_TOKEN || process.env.XCLAW_DISCORD_TOKEN;
  const enabled = conf.enabled === true && Boolean(token);
  const allowed = Array.isArray(conf.allowedChannelIds)
    ? new Set(conf.allowedChannelIds.map(String))
    : null;
  const workingDir = conf.workingDir;
  const policy = createChannelPolicy(cfg);
  const dmPolicy = conf.dmPolicy || "pairing";
  const rateLimiter = createRateLimiter(conf.rateLimit || cfg.channels?.rateLimit || {});
    const pairing = createPairingStore({ storePath: conf.pairingStorePath });
  let messagesHandled = 0;
  let lastError = null;
  let lastOkAt = null;
  let loopAlive = false;


  let ws = null;
  let heartbeatTimer = null;
  let sequence = null;
  let sessionId = null;
  let stopped = false;
      loopAlive = true;
      lastError = null;
  let botUser = null;
  let resumeUrl = null;

  async function rest(method, path, body) {
    const r = await fetch(`${REST}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "XClawBot (https://xclaw.local, 0.4.0)",
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    if (r.status === 204) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(`Discord REST ${method} ${path}: ${j.message || r.status}`);
    }
    return j;
  }

  async function sendMessage(channelId, content, replyTo) {
    const body = {
      content: truncate(content, 2000),
    };
    if (replyTo) {
      body.message_reference = { message_id: replyTo };
    }
    return rest("POST", `/channels/${channelId}/messages`, body);
  }

  async function typing(channelId) {
    try {
      await rest("POST", `/channels/${channelId}/typing`, {});
    } catch {
      /* ignore */
    }
  }

  function isAllowed(channelId) {
    return policy.allowedDiscordChannel(channelId);
  }

  async function sendChunked(channelId, text, replyTo) {
    const s = truncate(String(text || ""), 6000);
    const max = 1900;
    let first = true;
    for (let i = 0; i < s.length; i += max) {
      await sendMessage(channelId, s.slice(i, i + max), first ? replyTo : undefined);
      first = false;
    }
  }


  async function registerSlashCommands() {
    if (!botUser?.id) return;
    const commands = [
      {
        name: "ask",
        description: "Ask XClaw (runs agent with computer tools)",
        options: [
          {
            name: "prompt",
            description: "Your question or task",
            type: 3,
            required: true,
          },
        ],
      },
      { name: "status", description: "XClaw Discord status" },
      { name: "session", description: "Show bound session id/key" },
    ];
    try {
      await rest("PUT", `/applications/${botUser.id}/commands`, commands);
      console.log(`[discord] slash commands registered (${commands.length})`);
    } catch (err) {
      console.error(`[discord] slash register failed:`, err.message);
    }
  }

  async function replyInteraction(interaction, content, { ephemeral = false } = {}) {
    const body = {
      type: 4,
      data: {
        content: truncate(String(content || ""), 2000),
        flags: ephemeral ? 64 : 0,
      },
    };
    await rest(
      "POST",
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      body
    );
  }

  async function deferInteraction(interaction, { ephemeral = false } = {}) {
    await rest(
      "POST",
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      { type: 5, data: { flags: ephemeral ? 64 : 0 } }
    );
  }

  async function editInteraction(interaction, content) {
    await rest(
      "PATCH",
      `/webhooks/${botUser.id}/${interaction.token}/messages/@original`,
      { content: truncate(String(content || ""), 2000) }
    );
  }

  
  async function downloadDiscordAttachment(att, workspace) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = att.url || att.proxy_url;
    if (!url) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const dir = path.join(workspace, "discord-media");
    await fs.mkdir(dir, { recursive: true });
    const name = (att.filename || `att_${att.id || Date.now()}`).replace(/[^\w.\-]+/g, "_");
    const dest = path.join(dir, name);
    await fs.writeFile(dest, buf);
    return dest;
  }

async function handleInteraction(interaction) {
    if (!interaction || interaction.type !== 2) return; // APPLICATION_COMMAND
    const name = interaction.data?.name;
    const channelId = String(interaction.channel_id || "");
    const userId = String(interaction.member?.user?.id || interaction.user?.id || "");
    const isDm = !interaction.guild_id;
    const peerKind = isDm ? "dm" : "channel";

    if (name === "status") {
      await replyInteraction(
        interaction,
        `XClaw Discord up · ${botUser?.username || "?"} · handled ${messagesHandled}`
      );
      return;
    }
    if (name === "session") {
      const session = resolveBinding("discord", isDm ? userId : channelId, peerKind);
      await replyInteraction(
        interaction,
        `session ${session.id}\nkey ${session.sessionKey}`,
        { ephemeral: true }
      );
      return;
    }
    if (name === "ask") {
      const prompt = interaction.data?.options?.find((o) => o.name === "prompt")?.value;
      if (!prompt) {
        await replyInteraction(interaction, "prompt required", { ephemeral: true });
        return;
      }
      const rl = rateLimiter.allow(`discord:slash:${userId}`);
      if (!rl.ok) {
        await replyInteraction(interaction, "Rate limit — try again shortly.", {
          ephemeral: true,
        });
        return;
      }
      await deferInteraction(interaction);
      const session = resolveBinding("discord", isDm ? userId : channelId, peerKind);
      touchSession(session.id);
      try {
        const result = await replyWithAgent({
          cfg: {
            ...cfg,
            agent: {
              ...(cfg.agent || {}),
              model: session.agentModel || cfg.agent?.model,
            },
          },
          userId,
          channel: "discord",
          chatId: channelId,
          message: String(prompt),
          workingDir: session.workingDir || workingDir,
          onEvent: (e) => {
            if (e.type === "tool" && e.phase === "start") {
              console.log(`[discord]   → ${e.name}`);
            }
          },
        });
        await editInteraction(interaction, result.text);
        messagesHandled += 1;
      } catch (err) {
        try {
          await editInteraction(interaction, `Error: ${err.message}`);
        } catch {
          /* ignore */
        }
      }
    }
  }

  async function handleMessage(msg) {
    if (!msg || msg.author?.bot) return;
    const hasAttach = Array.isArray(msg.attachments) && msg.attachments.length > 0;
    if ((!msg.content || !String(msg.content).trim()) && !hasAttach) return;

    const channelId = String(msg.channel_id);
    const authorId = String(msg.author?.id || "");
    const isDm = !msg.guild_id;
    const peerKind = isDm ? "dm" : "channel";

    // Access control
    if (isDm && dmPolicy === "pairing") {
      const staticOk = isAllowed(channelId);
      const approved = pairing.isApproved("discord", authorId);
      if (!staticOk && !approved) {
        const { created, code } = pairing.upsertPairingRequest({
          channel: "discord",
          id: authorId,
          meta: { username: msg.author?.username || "", channelId },
        });
        if (created) {
          await sendMessage(
            channelId,
            buildPairingReply({
              channel: "discord",
              idLine: `Your user id: ${authorId}`,
              code,
            }),
            msg.id
          );
        }
        return;
      }
    } else if (!isDm) {
      if (!isAllowed(channelId) && dmPolicy !== "open") {
        return;
      }
    } else if (dmPolicy === "allowlist" && !isAllowed(channelId)) {
      return;
    }

    const session = resolveBinding("discord", isDm ? authorId : channelId, peerKind);
    touchSession(session.id);

    const workspace = session.workingDir || workingDir || process.cwd();
    const contentParts = [];
    const cleaned = String(msg.content || "")
      .replace(new RegExp(`<@!?${botUser?.id}>`, "g"), "")
      .trim();
    if (cleaned) contentParts.push(cleaned);
    if (Array.isArray(msg.attachments)) {
      for (const att of msg.attachments) {
        try {
          const dest = await downloadDiscordAttachment(att, workspace);
          if (dest) contentParts.push(`[Attached file saved to ${dest}]`);
        } catch (e) {
          contentParts.push(`[Attachment failed: ${e.message}]`);
        }
      }
    }
    const text = contentParts.join("\n\n").trim();
    if (!text) return;

    if (text === "/status" || text === "!status") {
      await sendMessage(
        channelId,
        `XClaw Discord up · ${botUser?.username || "?"} · handled ${messagesHandled}`,
        msg.id
      );
      return;
    }
    if (text === "/session" || text === "!session") {
      await sendMessage(
        channelId,
        `session ${session.id}\nkey ${session.sessionKey}`,
        msg.id
      );
      return;
    }


    console.log(`[discord] ← #${channelId}: ${text.slice(0, 80)}`);
    await typing(channelId);
    const typingIv = setInterval(() => typing(channelId), 8000);

    try {
      const inbound = fromDiscordMessage({
        ...msg,
        content: text,
        author: msg.author,
        channel_id: channelId,
        id: msg.id,
      });
      inbound.text = text;
      inbound.files = [];
      inbound.userId = authorId;
      const out = await processInbound(inbound, {
        cfg: {
          ...cfg,
          agent: {
            ...(cfg.agent || {}),
            model: session.agentModel || cfg.agent?.model,
          },
        },
        workingDir: session.workingDir || workingDir || workspace,
        rateLimiter,
        onEvent: (e) => {
          if (e.type === "tool" && e.phase === "start") {
            console.log(`[discord]   → ${e.name}`);
          }
        },
      });
      if (out.handled && out.reply) {
        await sendChunked(channelId, out.reply, msg.id);
        messagesHandled += 1;
        lastOkAt = new Date().toISOString();
        lastError = null;
        console.log(`[discord] → #${channelId}: ${String(out.reply).slice(0, 80)}`);
      }
    } catch (err) {
      lastError = err.message || String(err);
      console.error(`[discord] error:`, lastError);
      try {
        await sendMessage(channelId, `Error: ${err.message}`, msg.id);
      } catch {
        /* ignore */
      }
    } finally {
      clearInterval(typingIv);
    }
  }

  function sendWs(payload) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
    }
  }

  function identify() {
    sendWs({
      op: 2,
      d: {
        token,
        intents: INTENTS,
        properties: {
          os: process.platform,
          browser: "xclaw",
          device: "xclaw",
        },
      },
    });
  }

  function startHeartbeat(interval) {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      sendWs({ op: 1, d: sequence });
    }, interval);
  }

  function connect() {
    if (stopped) return;
    if (typeof WebSocket === "undefined") {
      console.error("[discord] WebSocket global not available (need Node 22+)");
      return;
    }
    const url = resumeUrl || GATEWAY_URL;
    console.log(`[discord] connecting…`);
    ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      console.log(`[discord] gateway open`);
    });

    ws.addEventListener("message", (ev) => {
      let pkt;
      try {
        pkt = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
      } catch {
        return;
      }
      if (pkt.s != null) sequence = pkt.s;

      switch (pkt.op) {
        case 10: // Hello
          startHeartbeat(pkt.d.heartbeat_interval);
          identify();
          break;
        case 11: // Heartbeat ACK
          break;
        case 0: // Dispatch
          if (pkt.t === "READY") {
            botUser = pkt.d.user;
            sessionId = pkt.d.session_id;
            resumeUrl = pkt.d.resume_gateway_url
              ? `${pkt.d.resume_gateway_url}/?v=10&encoding=json`
              : null;
            console.log(`[discord] ready as ${botUser.username}#${botUser.discriminator || "0"}`);
            registerSlashCommands().catch((e) =>
              console.error(`[discord] slash:`, e.message)
            );
          } else if (pkt.t === "MESSAGE_CREATE") {
            handleMessage(pkt.d).catch((e) =>
              console.error(`[discord] handle error:`, e.message)
            );
          } else if (pkt.t === "INTERACTION_CREATE") {
            handleInteraction(pkt.d).catch((e) =>
              console.error(`[discord] interaction:`, e.message)
            );
          }
          break;
        case 7: // Reconnect
          console.log(`[discord] server requested reconnect`);
          try {
            ws.close();
          } catch {
            /* */
          }
          break;
        case 9: // Invalid session
          console.log(`[discord] invalid session, re-identify`);
          sessionId = null;
          setTimeout(() => identify(), 2000);
          break;
        default:
          break;
      }
    });

    ws.addEventListener("close", (ev) => {
      console.log(`[discord] gateway closed (${ev.code})`);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (!stopped) {
        setTimeout(() => connect(), 5000);
      }
    });

    ws.addEventListener("error", (err) => {
      console.error(`[discord] ws error:`, err.message || err);
    });
  }

  return {
    name: "discord",
    get enabled() {
      return enabled;
    },
    async start() {
      if (!enabled) {
        console.log(`[discord] disabled (set channels.discord.enabled + token)`);
        return;
      }
      // Verify token
      try {
        botUser = await rest("GET", "/users/@me");
        console.log(`[discord] token OK · ${botUser.username}`);
      } catch (err) {
        console.error(`[discord] token check failed:`, err.message);
        return;
      }
      stopped = false;
      connect();
    },
    async stop() {
      stopped = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (ws) {
        try {
          ws.close(1000, "shutdown");
        } catch {
          /* */
        }
        ws = null;
      }
    },
    status() {
      return {
        name: "discord",
        enabled,
        username: botUser?.username || null,
        connected: Boolean(ws && ws.readyState === 1),
        messagesHandled,
        running: enabled && loopAlive && !stopped,
        loopAlive,
        lastError,
        lastOkAt,
        dmPolicy,
        policy: "allow-from+pairing",
      };
    },
  };
}
