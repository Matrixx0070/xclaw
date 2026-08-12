/**
 * Slack channel — Web API + conversations.history polling (no Bolt dependency).
 *
 * Config (cfg.channels.slack):
 *   enabled: boolean
 *   botToken: string   (xoxb-...)  or env SLACK_BOT_TOKEN
 *   appToken?: string  (xapp-... Socket Mode)
 *   socketMode?: boolean
 *   heartbeatMs?: number  // stale WS reconnect; default 90000, 0=off
 *   Events: message, app_mention (Socket Mode)
 *   channelIds: string[]  // public channel IDs to poll (required for poll mode)
 *   pollIntervalMs?: number  // default 4000
 *   workingDir?: string
 *   dmPolicy?: open | pairing | allowlist
 */
import { replyWithAgent, truncate } from "../base.mjs";
import { processInbound, fromSlackMessage } from "../runtime.mjs";
import { createChannelPolicy, workspaceForChat } from "../policy.mjs";
import { resolveBinding, touchSession } from "../../sessions/router.mjs";
import { createRateLimiter } from "../rate-limit.mjs";
import { handleChannelCommand } from "../commands.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  slackWsNoteConnectStart,
  slackWsNoteConnected,
  slackWsNoteFrame,
  slackWsNoteReconnect,
  slackWsNoteHandleMessage,
  slackWsNoteError,
  getSlackWsMetrics,
} from "./ws-metrics.mjs";

const API = "https://slack.com/api";

export function createSlackChannel(cfg) {
  const conf = cfg.channels?.slack || {};
  const token =
    conf.botToken ||
    conf.token ||
    process.env.SLACK_BOT_TOKEN ||
    process.env.XCLAW_SLACK_TOKEN;
  const channelIds = Array.isArray(conf.channelIds)
    ? conf.channelIds.map(String)
    : [];
  const appToken =
    conf.appToken || process.env.SLACK_APP_TOKEN || process.env.XCLAW_SLACK_APP_TOKEN || "";
  const socketMode = conf.socketMode === true || Boolean(appToken && conf.socketMode !== false && conf.enabled);
  // Poll mode needs channelIds; socket mode only needs bot+app tokens
  const enabled = Boolean(
    conf.enabled === true &&
      token &&
      (socketMode ? appToken : channelIds.length > 0)
  );
  const pollIntervalMs = Math.max(2000, Number(conf.pollIntervalMs) || 4000);
  /** Stale socket if no frame for this long (default 90s). 0 = disable. */
  const heartbeatMs = Math.max(
    0,
    Number(
      conf.heartbeatMs ??
        process.env.XCLAW_SLACK_HEARTBEAT_MS ??
        90_000
    )
  );
  const heartbeatCheckMs = Math.max(5_000, Math.min(30_000, Math.floor((heartbeatMs || 90_000) / 3)));
  const workingDir = conf.workingDir;
  const policy = createChannelPolicy(cfg);
  const rateLimiter = createRateLimiter(conf.rateLimit || cfg.channels?.rateLimit || {});

  let stopped = false;
  let loopPromise = null;
  let botUserId = null;
  let messagesHandled = 0;
  let lastError = null;
  let lastOkAt = null;
  let loopAlive = false;
  /** @type {Map<string, string>} channelId -> last ts */
  const cursors = new Map();

  async function api(method, body = {}) {
    const r = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) {
      throw new Error(`Slack ${method}: ${j.error || r.status}`);
    }
    return j;
  }

  async function sendMessage(channel, text, threadTs) {
    const body = {
      channel,
      text: truncate(String(text || ""), 39000),
    };
    if (threadTs) body.thread_ts = threadTs;
    return api("chat.postMessage", body);
  }

  async function downloadFile(file, workspace) {
    if (!file?.url_private || !file.id) return null;
    const res = await fetch(file.url_private, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const dir = path.join(workspace, "slack-media");
    await fs.mkdir(dir, { recursive: true });
    const name = (file.name || `file_${file.id}`).replace(/[^\w.\-]+/g, "_");
    const dest = path.join(dir, name);
    await fs.writeFile(dest, buf);
    return dest;
  }

  async function handleMessage(msg, channelId) {
    if (!msg || msg.subtype === "bot_message" || msg.bot_id) return;
    if (botUserId && msg.user === botUserId) return;
    let textRaw = String(msg.text || "").trim();
    // Strip bot @mention tokens (app_mention / message)
    if (botUserId && textRaw) {
      textRaw = textRaw.replace(new RegExp(`<@${botUserId}>`, "g"), "").trim();
    }
    const files = Array.isArray(msg.files) ? msg.files : [];
    if (!textRaw && !files.length) return;

    const session = resolveBinding("slack", channelId, "channel");
    touchSession(session.id);
    const workspace =
      session.workingDir ||
      workspaceForChat(cfg, "slack", channelId, workingDir) ||
      process.cwd();

    const parts = [];
    if (textRaw) parts.push(textRaw);
    for (const f of files) {
      try {
        const dest = await downloadFile(f, workspace);
        if (dest) parts.push(`[Attached file saved to ${dest}]`);
      } catch (e) {
        parts.push(`[File download failed: ${e.message}]`);
      }
    }
    const text = parts.join("\n\n").trim();
    if (!text) return;

    console.log(`[slack] ← ${channelId}: ${text.slice(0, 80)}`);
    try {
      const inbound = fromSlackMessage(
        { ...msg, text },
        { channelId, botUserId }
      );
      // text already includes attachment notes; avoid double-append
      inbound.files = [];
      inbound.text = text;
      const out = await processInbound(inbound, {
        cfg,
        workingDir: workspace,
        rateLimiter,
        onEvent: (e) => {
          if (e.type === "tool" && e.phase === "start") {
            console.log(`[slack]   → ${e.name}`);
          }
        },
      });
      if (out.handled && out.reply) {
        await sendMessage(channelId, out.reply, msg.thread_ts || msg.ts);
        messagesHandled += 1;
        lastOkAt = new Date().toISOString();
        lastError = null;
        console.log(`[slack] → ${channelId}: ${String(out.reply).slice(0, 80)}`);
      }
    } catch (err) {
      lastError = err.message || String(err);
      console.error(`[slack] error:`, lastError);
      try {
        await sendMessage(channelId, `Error: ${lastError}`, msg.thread_ts || msg.ts);
      } catch {
        /* */
      }
    }
  }

  async function pollOnce() {
    for (const channelId of channelIds) {
      const oldest = cursors.get(channelId);
      const body = {
        channel: channelId,
        limit: 20,
      };
      if (oldest) body.oldest = oldest;
      let j;
      try {
        j = await api("conversations.history", body);
      } catch (e) {
        console.error(`[slack] history ${channelId}:`, e.message);
        continue;
      }
      const messages = (j.messages || []).slice().reverse();
      for (const msg of messages) {
        if (oldest && msg.ts <= oldest) continue;
        await handleMessage(msg, channelId);
        if (!cursors.has(channelId) || msg.ts > cursors.get(channelId)) {
          cursors.set(channelId, msg.ts);
        }
      }
      // seed cursor so we don't replay entire history on first run
      if (!cursors.has(channelId) && j.messages?.length) {
        cursors.set(channelId, j.messages[0].ts);
      }
      if (!cursors.has(channelId)) {
        cursors.set(channelId, String(Date.now() / 1000));
      }
    }
  }

  async function pollLoop() {
    console.log(`[slack] poll starting channels=${channelIds.join(",")}`);
    // auth test
    try {
      const auth = await api("auth.test", {});
      botUserId = auth.user_id;
      console.log(`[slack] as ${auth.user} (${botUserId})`);
    } catch (e) {
      console.error(`[slack] auth.test failed:`, e.message);
    }
    while (!stopped) {
      try {
        await pollOnce();
      } catch (e) {
        console.error(`[slack] poll error:`, e.message);
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }


  async function socketModeLoop() {
    console.log(
      `[slack] Socket Mode starting` +
        (heartbeatMs ? ` heartbeat=${heartbeatMs}ms` : ` heartbeat=off`)
    );
    let reconnectAttempt = 0;
    try {
      const auth = await api("auth.test", {});
      botUserId = auth.user_id;
      console.log(`[slack] as ${auth.user} (${botUserId})`);
    } catch (e) {
      console.error(`[slack] auth.test failed:`, e.message);
    }
    while (!stopped) {
      try {
        slackWsNoteConnectStart();
        const r = await fetch("https://slack.com/api/apps.connections.open", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${appToken}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "",
        });
        const j = await r.json();
        if (!j.ok || !j.url) {
          console.error("[slack] connections.open failed:", j.error || r.status);
          throw new Error(j.error || "connections.open failed");
        }
        await new Promise((resolve) => {
          const ws = new WebSocket(j.url);
          let finished = false;
          let lastFrameAt = Date.now();
          let heartbeatTimer = null;
          let stopWatcher = null;

          const done = (reason) => {
            if (finished) return;
            finished = true;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            if (stopWatcher) clearInterval(stopWatcher);
            if (reason) console.log(`[slack] ws done: ${reason}`);
            if (reason && reason !== "stopped") {
              slackWsNoteReconnect(reason);
            }
            try {
              ws.close();
            } catch {
              /* */
            }
            resolve();
          };

          const noteFrame = () => {
            lastFrameAt = Date.now();
            slackWsNoteFrame();
          };

          ws.addEventListener("message", async (ev) => {
            noteFrame();
            let data;
            try {
              data = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
            } catch {
              return;
            }
            if (data.type === "hello") {
              reconnectAttempt = 0;
              slackWsNoteConnected();
              return;
            }
            // Slack may send explicit ping frames in some stacks; always ack envelopes
            if (data.envelope_id) {
              try {
                ws.send(JSON.stringify({ envelope_id: data.envelope_id }));
                noteFrame();
              } catch {
                /* */
              }
            }
            // Respond to application-level ping if present
            if (data.type === "ping" || data.payload?.type === "ping") {
              try {
                if (data.envelope_id) {
                  /* already acked */
                } else {
                  ws.send(JSON.stringify({ type: "pong" }));
                }
              } catch {
                /* */
              }
              return;
            }
            const payload = data.payload || data;
            const event =
              payload?.event ||
              data.event ||
              (payload?.type === "event_callback" ? payload.event : null);
            const et = event?.type;
            if (
              (et === "message" && !event.subtype) ||
              et === "app_mention"
            ) {
              const t0 = Date.now();
              try {
                const ch = event.channel || event.item?.channel;
                await handleMessage(event, ch);
              } catch (e) {
                console.error("[slack] handleMessage:", e.message);
              } finally {
                slackWsNoteHandleMessage(Date.now() - t0);
              }
            }
            if (data.type === "disconnect") {
              done("server disconnect");
            }
          });

          ws.addEventListener("close", () => done("close"));
          ws.addEventListener("error", (e) => {
            console.error("[slack] ws error", e.message || e);
            done("error");
          });

          // Heartbeat: no frame for heartbeatMs → force reconnect
          if (heartbeatMs > 0) {
            heartbeatTimer = setInterval(() => {
              const idle = Date.now() - lastFrameAt;
              if (idle >= heartbeatMs) {
                console.warn(
                  `[slack] heartbeat timeout: no frame for ${idle}ms (limit ${heartbeatMs}ms) — reconnecting`
                );
                done("heartbeat_timeout");
              }
            }, heartbeatCheckMs);
            if (heartbeatTimer.unref) heartbeatTimer.unref();
          }

          stopWatcher = setInterval(() => {
            if (stopped) done("stopped");
          }, 1000);
          if (stopWatcher.unref) stopWatcher.unref();
        });
        reconnectAttempt = 0;
      } catch (e) {
        console.error("[slack] socket loop:", e.message);
        slackWsNoteError(e.message);
      }
      if (stopped) break;
      reconnectAttempt += 1;
      const base = 1000;
      const max = 60_000;
      const exp = Math.min(max, base * 2 ** Math.min(reconnectAttempt, 6));
      const delay = Math.floor(Math.random() * exp);
      console.log(`[slack] reconnect in ${delay}ms (attempt ${reconnectAttempt})`);
      await new Promise((res) => setTimeout(res, delay));
    }
  }

  return {
    name: "slack",
    enabled,
    async start() {
      if (!enabled) {
        console.log("[slack] disabled (need enabled + botToken + (channelIds or appToken))");
        return;
      }
      stopped = false;
      lastError = null;
      loopAlive = true;
      if (socketMode && appToken) {
        loopPromise = socketModeLoop().finally(() => { loopAlive = false; });
      } else {
        loopPromise = pollLoop().finally(() => { loopAlive = false; });
      }
    },
    async stop() {
      stopped = true;
      if (loopPromise) await loopPromise.catch(() => {});
    },
    status() {
      return {
        name: "slack",
        enabled,
        messagesHandled,
        running: enabled && loopAlive && !stopped,
        loopAlive,
        stopped,
        lastError,
        lastOkAt,
        heartbeatMs,
        socketMode: Boolean(socketMode && appToken),
        mode: socketMode && appToken ? "socket" : "poll",
      };
    },
  };
}

