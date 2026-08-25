import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authorizeTelegramCallback } from "../src/channels/telegram/callback-auth.mjs";
import { createRateLimiter } from "../src/channels/rate-limit.mjs";

describe("telegram callback auth", () => {
  it("owner always ok", () => {
    const r = authorizeTelegramCallback({
      fromId: "1",
      chatId: "1",
      data: { kind: "apr" },
      ownerChatId: "1",
      dmPolicy: "pairing",
      allowFrom: [],
    });
    assert.equal(r.ok, true);
    assert.equal(r.via, "owner");
  });

  it("non-owner denied for apr when owner set", () => {
    const r = authorizeTelegramCallback({
      fromId: "2",
      chatId: "2",
      data: { kind: "apr" },
      ownerChatId: "1",
      dmPolicy: "allowlist",
      allowFrom: ["2"],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "CALLBACK_DENY");
  });

  it("allowlist can apr without owner", () => {
    const r = authorizeTelegramCallback({
      fromId: "9",
      chatId: "9",
      data: { kind: "pair" },
      ownerChatId: null,
      dmPolicy: "allowlist",
      allowFrom: ["9"],
    });
    assert.equal(r.ok, true);
  });

  it("open cannot apr without owner", () => {
    const r = authorizeTelegramCallback({
      fromId: "9",
      data: { kind: "apr" },
      ownerChatId: null,
      dmPolicy: "open",
      allowFrom: [],
    });
    assert.equal(r.ok, false);
  });

  it("RATE_LIMITED on callbacks", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 60000 });
    const opts = {
      fromId: "1",
      chatId: "1",
      data: { kind: "sug" },
      ownerChatId: "1",
      dmPolicy: "pairing",
      allowFrom: [],
      rateLimiter: rl,
    };
    assert.equal(authorizeTelegramCallback(opts).ok, true);
    const second = authorizeTelegramCallback(opts);
    assert.equal(second.ok, false);
    assert.equal(second.code, "RATE_LIMITED");
  });

  it("sug allowlist deny", () => {
    const r = authorizeTelegramCallback({
      fromId: "3",
      chatId: "3",
      data: { kind: "sug" },
      ownerChatId: null,
      dmPolicy: "allowlist",
      allowFrom: ["1"],
    });
    assert.equal(r.code, "CALLBACK_DENY");
  });

  // --- sug + pairing (the DEFAULT dmPolicy): WHO may activate a suggestion.
  // Tapping a `sug` button re-injects its prompt as a user message and RUNS the
  // agent (channels/telegram/index.mjs ~L534), so this branch is a
  // sender-authorization gate, not cosmetic. Authorization is a three-way OR —
  // the chat is paired, OR the individual sender is paired, OR the sender is
  // allowlisted. That OR had ZERO test: the existing "RATE_LIMITED" case is
  // sug+pairing but the sender is the owner, so it short-circuits at the owner
  // check and never reaches this block. Replacing the whole condition with
  // `if (false)` (accept anyone) left the FULL suite green (3583/0), so a silent
  // revert of this default-policy gate would ship unnoticed. These pin each arm.

  it("sug pairing: unpaired, non-allowlisted sender is DENIED (default policy)", () => {
    const r = authorizeTelegramCallback({
      fromId: "500",
      chatId: "500",
      data: { kind: "sug" },
      ownerChatId: "1", // an owner exists, but the tapper is not the owner
      dmPolicy: "pairing",
      allowFrom: [],
      isApproved: () => false, // not paired on either channel id
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "CALLBACK_DENY");
  });

  it("sug pairing: a paired sender is ALLOWED (isApproved-by-from arm)", () => {
    const r = authorizeTelegramCallback({
      fromId: "500",
      chatId: "500",
      data: { kind: "sug" },
      ownerChatId: "1",
      dmPolicy: "pairing",
      allowFrom: [],
      isApproved: (ch, id) => ch === "telegram" && id === "500",
    });
    assert.equal(r.ok, true);
    assert.equal(r.via, "sug_policy");
  });

  it("sug pairing: approval keyed on the chatId still allows (isApproved-by-chat arm)", () => {
    // the chat is paired even though this individual fromId is not — the OR's
    // isApproved(chatId) arm must carry it.
    const r = authorizeTelegramCallback({
      fromId: "777", // not paired
      chatId: "42", // the paired chat
      data: { kind: "sug" },
      ownerChatId: null,
      dmPolicy: "pairing",
      allowFrom: [],
      isApproved: (ch, id) => ch === "telegram" && id === "42",
    });
    assert.equal(r.ok, true);
    assert.equal(r.via, "sug_policy");
  });

  it("sug pairing: an allowlisted sender is ALLOWED even when unpaired (inAllow arm)", () => {
    const r = authorizeTelegramCallback({
      fromId: "88",
      chatId: "88",
      data: { kind: "sug" },
      ownerChatId: null,
      dmPolicy: "pairing",
      allowFrom: ["88"],
      isApproved: () => false,
    });
    assert.equal(r.ok, true);
    assert.equal(r.via, "sug_policy");
  });
});
