import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runTelegramPollLoop,
  isFastLaneUpdate,
} from "../src/channels/telegram/poll-loop.mjs";

// Real incident (2026-08-13, live Telegram test): with `await onUpdate(u)`
// for every update, a turn blocked on human approval (up to 120s) froze the
// whole poll loop — the owner's `/approve` could not even be READ from
// Telegram until the SLA had already denied the approval, so same-channel
// approval always failed with `unknown_pending`. Commands and button
// callbacks must be able to overtake a blocked turn; normal messages keep
// per-chat ordering but must not block the loop itself.

const msgUpdate = (id, chatId, text) => ({
  update_id: id,
  message: { message_id: id, chat: { id: chatId, type: "private" }, text },
});

describe("telegram poll fast lane", () => {
  it("classifies commands and callbacks as fast-lane", () => {
    assert.equal(isFastLaneUpdate(msgUpdate(1, 1, "/approve apr_x")), true);
    assert.equal(isFastLaneUpdate(msgUpdate(1, 1, "  /pending")), true);
    assert.equal(isFastLaneUpdate({ update_id: 2, callback_query: { id: "cb" } }), true);
    assert.equal(isFastLaneUpdate(msgUpdate(3, 1, "hello there")), false);
    assert.equal(isFastLaneUpdate({ update_id: 4, message: { chat: { id: 1 }, caption: "/cmd" } }), true);
  });

  it("a /approve arriving while a turn is blocked is processed BEFORE the turn completes", async () => {
    const order = [];
    let releaseTurn;
    const turnGate = new Promise((r) => (releaseTurn = r));
    let approveProcessed;
    const approveDone = new Promise((r) => (approveProcessed = r));

    let batch = 0;
    const api = async (method) => {
      if (method !== "getUpdates") return {};
      batch += 1;
      // batch 1: a normal message whose turn blocks awaiting approval.
      if (batch === 1) return [msgUpdate(1, 100, "run bash please")];
      // batch 2: the owner's /approve — must be readable DESPITE the blocked turn.
      if (batch === 2) return [msgUpdate(2, 100, "/approve apr_123")];
      // afterwards: idle until stopped.
      await new Promise((r) => setTimeout(r, 20));
      return [];
    };

    let stopped = false;
    const loop = runTelegramPollLoop({
      api,
      conf: {},
      isStopped: () => stopped,
      getOffset: () => 0,
      setOffset: () => {},
      onUpdate: async (u) => {
        const text = u.message?.text || "";
        if (text.startsWith("/approve")) {
          order.push("approve");
          releaseTurn(); // approving unblocks the turn — like the real gate
          approveProcessed();
          return;
        }
        order.push("turn:start");
        await turnGate; // simulates approvalGate.authorize blocking the turn
        order.push("turn:end");
      },
    });

    await approveDone;
    // Give the released turn a beat to finish, then stop the loop.
    await new Promise((r) => setTimeout(r, 50));
    stopped = true;
    await loop;

    assert.deepEqual(order, ["turn:start", "approve", "turn:end"]);
  });

  it("normal messages in the same chat still process strictly in order", async () => {
    const order = [];
    let batch = 0;
    const api = async (method) => {
      if (method !== "getUpdates") return {};
      batch += 1;
      if (batch === 1) {
        return [msgUpdate(1, 100, "first"), msgUpdate(2, 100, "second")];
      }
      await new Promise((r) => setTimeout(r, 20));
      return [];
    };

    let stopped = false;
    const loop = runTelegramPollLoop({
      api,
      conf: {},
      isStopped: () => stopped,
      getOffset: () => 0,
      setOffset: () => {},
      onUpdate: async (u) => {
        const text = u.message?.text;
        order.push(`${text}:start`);
        // First message is slower — without per-chat serialization the
        // second would interleave and finish first.
        await new Promise((r) => setTimeout(r, text === "first" ? 60 : 5));
        order.push(`${text}:end`);
      },
    });

    await new Promise((r) => setTimeout(r, 150));
    stopped = true;
    await loop;

    assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"]);
  });

  it("different chats may process concurrently (loop is never blocked)", async () => {
    const order = [];
    let batch = 0;
    const api = async (method) => {
      if (method !== "getUpdates") return {};
      batch += 1;
      if (batch === 1) {
        return [msgUpdate(1, 100, "slow-chat"), msgUpdate(2, 200, "fast-chat")];
      }
      await new Promise((r) => setTimeout(r, 20));
      return [];
    };

    let stopped = false;
    const loop = runTelegramPollLoop({
      api,
      conf: {},
      isStopped: () => stopped,
      getOffset: () => 0,
      setOffset: () => {},
      onUpdate: async (u) => {
        const text = u.message?.text;
        await new Promise((r) => setTimeout(r, text === "slow-chat" ? 80 : 5));
        order.push(text);
      },
    });

    await new Promise((r) => setTimeout(r, 150));
    stopped = true;
    await loop;

    assert.deepEqual(order, ["fast-chat", "slow-chat"]);
  });
});
