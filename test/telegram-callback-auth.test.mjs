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

  // RULE(c) axis: chatId vs fromId are DISTINCT principals in a group callback —
  // fromId is the user who tapped, chatId is `cq.message.chat.id` (the GROUP).
  // The pairing gate ORs three approval arms; the sibling test above isolates the
  // isApproved(chatId) arm (fromId 777 unpaired, chat 42 paired). The mirror — an
  // approved USER acting in an un-paired GROUP — must be carried by the
  // isApproved(fromId) arm ALONE. The earlier "isApproved-by-from arm" test uses
  // chatId===fromId===500, so the chatId arm masks it: dropping the fromId arm
  // (`&& !isApproved("telegram", fromId)`) from the deny predicate left the FULL
  // suite green (3651/0) — a silent removal of user-level pairing authorization,
  // downgrading "an approved user may act in any chat" to "only approved chats may
  // act", would ship unnoticed. This isolates the user-principal arm.
  it("sug pairing: an approved SENDER in an un-paired group chat is ALLOWED (isApproved-by-from arm, isolated)", () => {
    const r = authorizeTelegramCallback({
      fromId: "500", // the paired USER who tapped
      chatId: "42", // an un-paired GROUP chat — a DISTINCT id, not approved
      data: { kind: "sug" },
      ownerChatId: null,
      dmPolicy: "pairing",
      allowFrom: [], // inAllow arm cannot carry it either
      isApproved: (ch, id) => ch === "telegram" && id === "500", // ONLY the user is paired
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

  // --- pair/apr + NO owner, non-open policy: the DENY sibling of the allowlist
  // ACCEPT arm above. For an admin/approval callback (`apr` re-runs the pending
  // action's approve/deny; `pair` completes pairing) in a deployment with NO
  // ownerChatId and the DEFAULT pairing policy (or the allowlist policy), the
  // ONLY authorized path is allowlist membership (callback-auth.mjs:72). A
  // non-allowlisted tapper — e.g. another member of a group chat who can see the
  // inline Approve/Deny keyboard — must be DENIED at line 73. That ACCEPT arm is
  // pinned above ("allowlist can apr without owner"); this DENY arm had NO test:
  // every other pair/apr case sets an owner (→ owner-mismatch deny, line 62), is
  // allowlisted (→ allow, line 72), or uses the open policy (→ its own deny,
  // line 66). Flipping line 73 to `{ ok: true }` left the FULL suite green
  // (3639/0) — a silent fail-open on the approval-callback gate would ship
  // unnoticed. These pin the DENY on both admin kinds and both non-open policies.
  for (const kind of ["apr", "pair"]) {
    for (const policy of ["pairing", "allowlist"]) {
      it(`${kind}/${policy}: no owner + non-allowlisted sender is DENIED (line 73)`, () => {
        const r = authorizeTelegramCallback({
          fromId: "600",
          chatId: "600",
          data: { kind },
          ownerChatId: null,
          dmPolicy: policy,
          allowFrom: [], // NOT allowlisted
          isApproved: () => false,
        });
        assert.equal(r.ok, false, `${kind}/${policy} no-owner non-allowlisted must deny`);
        assert.equal(r.code, "CALLBACK_DENY");
      });
    }
  }

  // RULE(b)/RULE(c) sibling-predicate: `inAllow` (callback-auth.mjs:46) is a
  // SECOND two-principal OR — `allow.includes(fromId) || allow.includes(chatId)`
  // — judging the SAME axis the isApproved OR above judges: fromId is the USER who
  // tapped, chatId is `cq.message.chat.id` (the GROUP). It gates three sites: the
  // sug/allowlist deny (:49), the sug/pairing deny (:53), and the PRIVILEGED
  // pair|apr allow (:72, which re-runs a pending action's approve/deny). The
  // isApproved OR's two arms are pinned above (by-chat, by-from) — but coverage
  // does NOT transfer to this sibling OR: every inAllow-exercising test collapses
  // chatId===fromId ("allowlist can apr" 9/9, "allowlisted sender" 88/88, "sug
  // allowlist deny" 3/3) or uses allowFrom:[] (inAllow≡false), so NEITHER arm was
  // isolated. Dropping the chatId arm (`inAllow = allow.includes(fromId)`) left the
  // FULL suite green (3657/0), and dropping the fromId arm did too — a silent
  // narrowing of allowlist authorization from "the CHAT is allowlisted OR the USER
  // is allowlisted" down to a single principal would ship unnoticed. These isolate
  // each arm at a deny site, plus the chatId arm at the privileged apr allow site.

  it("inAllow chatId-arm: an allowlisted GROUP authorizes a non-allowlisted sender (sug/allowlist)", () => {
    // the CHAT (42) is allowlisted; the tapping USER (999) is not — the
    // allow.includes(chatId) arm ALONE must carry it past the :49 deny.
    const r = authorizeTelegramCallback({
      fromId: "999",
      chatId: "42",
      data: { kind: "sug" },
      ownerChatId: null,
      dmPolicy: "allowlist",
      allowFrom: ["42"], // only the chat id
      isApproved: () => false,
    });
    assert.equal(r.ok, true);
    assert.equal(r.via, "sug_policy");
  });

  it("inAllow fromId-arm: an allowlisted USER is authorized in a non-allowlisted chat (sug/allowlist)", () => {
    // mirror: the USER (500) is allowlisted, the CHAT (42) is not — the
    // allow.includes(fromId) arm ALONE must carry it.
    const r = authorizeTelegramCallback({
      fromId: "500",
      chatId: "42",
      data: { kind: "sug" },
      ownerChatId: null,
      dmPolicy: "allowlist",
      allowFrom: ["500"], // only the user id
      isApproved: () => false,
    });
    assert.equal(r.ok, true);
    assert.equal(r.via, "sug_policy");
  });

  it("inAllow chatId-arm carries the privileged apr allow (:72): allowlisted GROUP, non-allowlisted sender", () => {
    // apr re-runs a pending action's approve/deny — a group member authorized here
    // solely because the GROUP is allowlisted is the privileged sibling of line 73.
    const r = authorizeTelegramCallback({
      fromId: "999",
      chatId: "42",
      data: { kind: "apr" },
      ownerChatId: null,
      dmPolicy: "allowlist",
      allowFrom: ["42"], // only the chat id
      isApproved: () => false,
    });
    assert.equal(r.ok, true);
    assert.equal(r.via, "allowlist");
  });
});
