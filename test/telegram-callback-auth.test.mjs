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
});
