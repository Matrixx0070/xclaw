/**
 * Channel manager — start/stop Telegram, Discord, Slack, Email
 * R1: restartChannel + get for health watchdog
 */
import { createTelegramChannel } from "./telegram/index.mjs";
import { createDiscordChannel } from "./discord/index.mjs";
import { createSlackChannel } from "./slack/index.mjs";
import { createEmailChannel } from "./email/index.mjs";

export function createChannelManager(cfg) {
  const telegram = createTelegramChannel(cfg);
  const discord = createDiscordChannel(cfg);
  const slack = createSlackChannel(cfg);
  const email = createEmailChannel(cfg);
  const channels = [telegram, discord, slack, email];
  const byName = Object.fromEntries(channels.map((c) => [c.name, c]));

  return {
    async startAll() {
      for (const ch of channels) {
        try {
          await ch.start();
        } catch (err) {
          console.error(`[channels] ${ch.name} failed to start:`, err.message);
          if (typeof ch.markError === "function") ch.markError(err.message);
        }
      }
    },
    async stopAll() {
      for (const ch of channels) {
        try {
          await ch.stop();
        } catch (err) {
          console.error(`[channels] ${ch.name} stop error:`, err.message);
        }
      }
    },
    get(name) {
      return byName[name] || null;
    },
    async restartChannel(name) {
      const ch = byName[name];
      if (!ch) throw new Error(`unknown channel ${name}`);
      try {
        await ch.stop();
      } catch {
        /* */
      }
      await ch.start();
      return { ok: true, name };
    },
    async restart(name) {
      return this.restartChannel(name);
    },
    status() {
      return channels.map((ch) => {
        const st = ch.status();
        return st;
      });
    },
  };
}
