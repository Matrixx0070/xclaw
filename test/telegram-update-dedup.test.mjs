/**
 * RULE(n) sweep #65 — the Telegram update dedup gate. Fail-opening
 * `if (seenUpdateIds.has(uid)) return` left the FULL suite green
 * (3864/0): webhook retries / poll redeliveries would double-process
 * every message (double agent runs, duplicate replies, double cost).
 * Pins the gate behaviorally through the exposed handleUpdate against a
 * local Bot API mock (XCLAW_TELEGRAM_API_BASE, the documented test
 * seam): a replayed update_id must produce exactly one sendMessage, a
 * fresh id must still send (the test cannot pass by sending nothing),
 * the gate must fire before any message parsing, and a recent id must
 * survive SEEN_MAX eviction.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import { createTelegramChannel } from "../src/channels/telegram/index.mjs";

let server;
let calls;
let savedBase;

function startMock() {
  calls = [];
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        calls.push({ path: req.url, body: body ? JSON.parse(body) : null });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, result: { message_id: calls.length } }));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

const sends = () => calls.filter((c) => c.path.endsWith("/sendMessage"));

function makeChannel() {
  return createTelegramChannel({
    channels: {
      telegram: { enabled: true, token: "fake-token-not-real", dmPolicy: "open" },
    },
  });
}

function statusUpdate(updateId, msgId = updateId) {
  return {
    update_id: updateId,
    message: {
      message_id: msgId,
      chat: { id: 42, type: "private" },
      from: { id: 42 },
      text: "/status",
    },
  };
}

describe("telegram update dedup (sweep #65)", () => {
  before(async () => {
    const port = await startMock();
    savedBase = process.env.XCLAW_TELEGRAM_API_BASE;
    process.env.XCLAW_TELEGRAM_API_BASE = `http://127.0.0.1:${port}`;
  });
  after(() => {
    if (savedBase === undefined) delete process.env.XCLAW_TELEGRAM_API_BASE;
    else process.env.XCLAW_TELEGRAM_API_BASE = savedBase;
    server?.close();
  });

  it("a replayed update_id sends once; a fresh id still sends", async () => {
    const ch = makeChannel();
    await ch.handleUpdate(statusUpdate(1001));
    await ch.handleUpdate(statusUpdate(1001));
    assert.equal(sends().length, 1, "duplicate delivery must not double-send");
    await ch.handleUpdate(statusUpdate(1002));
    assert.equal(sends().length, 2, "a genuinely new update must still process");
  });

  it("dedup registers before message parsing (a bare update_id is remembered)", async () => {
    const ch = makeChannel();
    const start = sends().length;
    await ch.handleUpdate({ update_id: 2001 });
    await ch.handleUpdate(statusUpdate(2001));
    assert.equal(sends().length, start, "an id first seen without a message stays deduped");
  });

  it("SEEN_MAX eviction drops the OLDEST half — a just-pre-trigger id stays deduped", async () => {
    const ch = makeChannel();
    const start = sends().length;
    // 2001 inserts fires exactly one eviction (size > 2000 → drop the first
    // 1000). The id inserted just before the trigger (#2000) is in the kept
    // half for correct code; an eviction that drops the NEWER half loses it.
    for (let i = 0; i < 2001; i++) {
      await ch.handleUpdate({ update_id: 10_000 + i });
    }
    await ch.handleUpdate(statusUpdate(10_000 + 1999));
    assert.equal(sends().length, start, "a recent (kept-half) id must still be deduped after eviction");
    // And an evicted (oldest-half) id is forgotten by design — reprocessing
    // it proves the set actually shrank rather than never evicting.
    await ch.handleUpdate(statusUpdate(10_000));
    assert.equal(sends().length, start + 1, "an oldest-half id is evicted by design");
  });
});
