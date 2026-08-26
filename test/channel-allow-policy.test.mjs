/**
 * Channel sender authorization — WHO may command the bot.
 *
 * `isSenderIdAllowed` (src/channels/allow-from.mjs) is the decision behind every
 * channel access gate. It is used ONLY by createChannelPolicy (gateTelegram /
 * allowedChatId / allowedDiscordChannel) — the Telegram callback path
 * (authorizeTelegramCallback) has its OWN inline `allow.includes()` and does not
 * touch it. In allowlist mode the live wiring is the sole gate to the agent:
 *
 *   // src/channels/telegram/index.mjs
 *   if (dmPolicy === "allowlist") {
 *     const gate = policy.gateTelegram(update);
 *     if (!gate.ok) { recordTelegramDeny("allowlist"); return; }  // <- stops here
 *   }
 *
 * Why this file exists (sweep #21, 3.204.0): NO test drove isSenderIdAllowed or
 * gateTelegram's allow/deny. Mutating the core compare to accept anyone
 * (`return allow.entries.includes(id)` -> `return true`) left the FULL suite
 * green (3536/0): a configured allowlist would admit ANY chat id, so a chat NOT
 * in `allowedChatIds` could drive the agent over Telegram. The webhook-wiring
 * test (sweep #15) uses gateTelegram()=false only as a mechanism to reach the
 * pairing branch and never distinguishes allow from deny (an outbound fires
 * either way). These tests pin BOTH the pure gate and its wiring.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compileAllowlist,
  isSenderIdAllowed,
  isEmailSenderAllowed,
} from "../src/channels/allow-from.mjs";
import { createChannelPolicy } from "../src/channels/policy.mjs";

describe("channel sender authorization", () => {
  describe("isSenderIdAllowed — the pure gate", () => {
    it("allows a sender listed in a configured allowlist", () => {
      assert.equal(isSenderIdAllowed(compileAllowlist(["555"]), "555", true), true);
    });

    it("DENIES a sender not in a configured allowlist", () => {
      // The proven mutation: `return true` here admits every non-listed sender.
      assert.equal(
        isSenderIdAllowed(compileAllowlist(["555"]), "999", true),
        false,
        "a non-listed sender must be denied — accept-anything is a full channel-auth bypass"
      );
    });

    // The compare is exact (`entries.includes(id)`). An embedding negative — a
    // value that CONTAINS or is a PREFIX of an allowed id — is the only thing
    // that separates `includes`/`startsWith` weakenings from a real `===` match.
    it("DENIES a superstring of an allowed id (1000 vs 100)", () => {
      assert.equal(isSenderIdAllowed(compileAllowlist(["100"]), "1000", true), false);
    });
    it("DENIES a prefix of an allowed id (100 vs 1000)", () => {
      assert.equal(isSenderIdAllowed(compileAllowlist(["1000"]), "100", true), false);
    });

    it("wildcard '*' admits any sender", () => {
      assert.equal(isSenderIdAllowed(compileAllowlist(["*"]), "anything", true), true);
    });

    it("empty allowlist honors the allowWhenEmpty policy (open vs fail-closed)", () => {
      const empty = compileAllowlist([]);
      assert.equal(isSenderIdAllowed(empty, "x", true), true, "open default admits");
      assert.equal(isSenderIdAllowed(empty, "x", false), false, "fail-closed default denies");
    });

    it("a missing senderId against a configured allowlist is denied", () => {
      assert.equal(isSenderIdAllowed(compileAllowlist(["555"]), undefined, true), false);
    });

    it("matches case-insensitively (username entries)", () => {
      const allow = compileAllowlist(["Alice"]);
      assert.equal(isSenderIdAllowed(allow, "alice", true), true);
      assert.equal(isSenderIdAllowed(allow, "bob", true), false);
    });
  });

  describe("gateTelegram — the wiring (allowlist mode)", () => {
    const policy = createChannelPolicy({
      channels: {
        telegram: {
          dmPolicy: "allowlist",
          allowedChatIds: ["555"],
          groupAllowFrom: ["777"],
        },
      },
    });
    const dm = (id) => ({ message: { chat: { id, type: "private" }, from: { id } } });
    const group = (id) => ({ message: { chat: { id, type: "supergroup" } } });
    const cbq = (id) => ({ callback_query: { message: { chat: { id, type: "private" } } } });

    it("allows a DM from a listed chat", () => {
      assert.equal(policy.gateTelegram(dm(555)).ok, true);
    });

    it("DENIES a DM from an unlisted chat (chat_not_allowed)", () => {
      const g = policy.gateTelegram(dm(999));
      assert.equal(g.ok, false);
      assert.equal(g.reason, "chat_not_allowed");
    });

    it("uses the GROUP allowlist for group chats, distinct from the DM list", () => {
      assert.equal(policy.gateTelegram(group(777)).ok, true, "a group id in groupAllowFrom passes");
      assert.equal(
        policy.gateTelegram(group(555)).ok,
        false,
        "a DM-only id must NOT pass the group gate"
      );
    });

    it("extracts the chat id from callback_query updates too", () => {
      assert.equal(policy.gateTelegram(cbq(555)).ok, true);
      assert.equal(policy.gateTelegram(cbq(999)).ok, false);
    });

    it("rejects an update with no chat id (no_chat)", () => {
      const g = policy.gateTelegram({});
      assert.equal(g.ok, false);
      assert.equal(g.reason, "no_chat");
    });
  });

  // Discord is the OTHER live call site of the same shared gate. isSenderIdAllowed
  // is pinned above, but that does NOT pin its Discord wiring: allowedDiscordChannel
  // -> isSenderIdAllowed(dcAllow, ...) is the sole guard before the agent runs on a
  // Discord message (discord/index.mjs:287-291 `return` on !isAllowed). Sweep #23
  // (3.205.0): no test drove gateDiscord/allowedDiscordChannel. Two mutations left
  // the FULL suite green (3549/0): (A) allowedDiscordChannel -> `return true` admits
  // ANY channel; (B) dcAllow dropping the `allowedChannelIds` config key compiles an
  // EMPTY allowlist so allowWhenEmpty admits everyone — a silent, config-shaped
  // bypass. Both are closed here. (The both-layers discipline of sweep #15.)
  describe("gateDiscord — the wiring (allowlist)", () => {
    const policy = createChannelPolicy({
      channels: { discord: { allowedChannelIds: ["123"] } },
    });

    it("allows a message from a listed channel", () => {
      assert.equal(policy.gateDiscord({ channelId: "123" }).ok, true);
    });

    it("DENIES a message from an unlisted channel (channel_not_allowed)", () => {
      // Catches BOTH proven mutations: accept-anything, and the dropped
      // `allowedChannelIds` key (which would compile an empty admit-all list).
      const g = policy.gateDiscord({ channelId: "999" });
      assert.equal(
        g.ok,
        false,
        "an unlisted channel must be denied — accept-anything is a full channel-auth bypass"
      );
      assert.equal(g.reason, "channel_not_allowed");
    });

    it("reads the channel id from snake_case (channel_id) too", () => {
      assert.equal(policy.gateDiscord({ channel_id: "123" }).ok, true);
      assert.equal(policy.gateDiscord({ channel_id: "999" }).ok, false);
    });

    it("rejects a message with no channel id (no_channel)", () => {
      const g = policy.gateDiscord({});
      assert.equal(g.ok, false);
      assert.equal(g.reason, "no_channel");
    });

    it("honors the documented allowFrom alias key when allowedChannelIds is absent", () => {
      const p2 = createChannelPolicy({ channels: { discord: { allowFrom: ["abc"] } } });
      assert.equal(p2.allowedDiscordChannel("abc"), true);
      assert.equal(p2.allowedDiscordChannel("xyz"), false);
    });

    it("an unconfigured Discord allowlist admits (open default, matching Telegram)", () => {
      const p3 = createChannelPolicy({ channels: { discord: {} } });
      assert.equal(p3.allowedDiscordChannel("anything"), true);
    });
  });

  // Email is the ONE channel whose sender gate did NOT route through the shared
  // matcher. handleMail (email/index.mjs) rolled its own `allowFrom.some(a =>
  // fromAddr.includes(a))` — a SUBSTRING test, the classic domain-suffix bypass.
  // Sweep #33 (3.215.0): a bare-domain allowlist `["corp.com"]` admitted
  // `attacker@corp.com.evil.com` (suffix), `attacker@evil-corp.com` (no dot
  // boundary), and even `corp.company@x.com` (substring in the LOCAL part) — any
  // of which then drove the agent over email. Reproduced by mutating the fixed
  // matcher back to the shipped `some(a => addr.includes(a))`: the three bypass
  // cases below go RED alone while the legit cases stay green (a real fail-OPEN,
  // proven both directions). isEmailSenderAllowed does address-OR-domain matching,
  // never substring. Email is disabled on this deployment, so this is a latent
  // fail-open in shipped/wired code, not a live leak — it bites any user who
  // enables email with a domain allowFrom.
  describe("isEmailSenderAllowed — address/domain, never substring", () => {
    it("allows a legit address under a bare-domain entry", () => {
      assert.equal(isEmailSenderAllowed(["corp.com"], "alice@corp.com"), true);
    });
    it("allows a subdomain of a bare-domain entry", () => {
      assert.equal(isEmailSenderAllowed(["corp.com"], "bob@mail.corp.com"), true);
    });
    it("DENIES a suffix-bypass address (corp.com.evil.com)", () => {
      // The proven mutation: `addr.includes("corp.com")` is TRUE here → admitted.
      assert.equal(
        isEmailSenderAllowed(["corp.com"], "attacker@corp.com.evil.com"),
        false,
        "a suffix that appends the allowed domain must be denied — substring match is a full email-auth bypass"
      );
    });
    it("DENIES a look-alike domain with no dot boundary (evil-corp.com)", () => {
      assert.equal(isEmailSenderAllowed(["corp.com"], "attacker@evil-corp.com"), false);
    });
    it("DENIES the allowed domain appearing only in the local part", () => {
      assert.equal(isEmailSenderAllowed(["corp.com"], "corp.company@x.com"), false);
    });
    it("full-address entries match exactly, not by domain", () => {
      assert.equal(isEmailSenderAllowed(["alice@corp.com"], "alice@corp.com"), true);
      assert.equal(
        isEmailSenderAllowed(["alice@corp.com"], "eve@corp.com"),
        false,
        "a full-address entry must not admit a different mailbox at the same domain"
      );
    });
    it("empty/absent allowlist is open (preserves prior no-allowFrom behavior)", () => {
      assert.equal(isEmailSenderAllowed([], "anyone@x.com"), true);
      assert.equal(isEmailSenderAllowed(undefined, "anyone@x.com"), true);
    });
    it("wildcard '*' admits any sender", () => {
      assert.equal(isEmailSenderAllowed(["*"], "anyone@x.com"), true);
    });
    it("matches case-insensitively", () => {
      assert.equal(isEmailSenderAllowed(["Corp.com"], "Alice@CORP.com"), true);
    });
    it("a blank/malformed sender against a configured list is denied", () => {
      assert.equal(isEmailSenderAllowed(["corp.com"], ""), false);
      assert.equal(isEmailSenderAllowed(["corp.com"], "not-an-email"), false);
    });
  });
});
