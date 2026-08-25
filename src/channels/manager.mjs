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

  // Serialize lifecycle operations per channel. The 2026-08-24 restart storm:
  // the health watchdog's tick and a /channels/manage/restart ran restartChannel
  // concurrently, interleaving stop/start so two telegram poll loops ran at
  // once and terminated each other's getUpdates (CONFLICT) until a process
  // restart. Every start/stop/restart for one channel now queues behind the
  // previous one.
  const lifecycleTail = new Map(); // name → settled-safe tail promise
  function serialize(name, fn) {
    const prev = lifecycleTail.get(name) || Promise.resolve();
    const run = prev.then(fn, fn);
    lifecycleTail.set(
      name,
      run.catch(() => {})
    );
    return run;
  }

  return {
    async startAll() {
      for (const ch of channels) {
        try {
          await serialize(ch.name, () => ch.start());
        } catch (err) {
          console.error(`[channels] ${ch.name} failed to start:`, err.message);
          if (typeof ch.markError === "function") ch.markError(err.message);
        }
      }
    },
    async stopAll() {
      for (const ch of channels) {
        try {
          await serialize(ch.name, () => ch.stop());
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
      return serialize(name, async () => {
        try {
          await ch.stop();
        } catch {
          /* */
        }
        const res = await ch.start();
        // A channel that DECLINES to start (misconfigured, or standby behind
        // a single-writer lock) used to be indistinguishable from a clean
        // start, so the watchdog reset consecutiveFail on every pass and its
        // circuit-open alert was unreachable — it restart-looped a dead
        // channel forever in silence. Channels whose start() returns nothing
        // keep the old assume-started shape.
        return res && res.started === false
          ? {
              ok: false,
              name,
              reason: res.reason || "declined",
              standby: res.standby === true,
            }
          : { ok: true, name };
      });
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
