/**
 * RULE(n) sweep #66 — the approval-prompt dedup latch
 * (`promptedApprovals`) behind Telegram's notifyOwnerApproval. The
 * existing coverage was a SOURCE pin (`/promptedApprovals\.has/` regex)
 * which still matches a fail-opened `if (false && …has(…))` — proven:
 * the mutant left the FULL suite green (3867/0), i.e. every approval
 * re-emission would re-prompt the owner (the exact v3.124.0 duplicate-
 * prompt storm). Pinned BEHAVIORALLY via the local Bot API mock: same
 * id prompts once, a failed delivery does not latch (stays
 * re-promptable), and the >200 clear actually fires (bounded memory,
 * by-design re-prompt after clear).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import { createTelegramChannel } from "../src/channels/telegram/index.mjs";

let server;
let calls;
let savedBase;
let failNext = 0;

function startMock() {
  calls = [];
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = body ? JSON.parse(body) : null;
        calls.push({ path: req.url, body: parsed });
        res.setHeader("content-type", "application/json");
        if (req.url.endsWith("/sendMessage") && failNext > 0) {
          failNext -= 1;
          res.end(JSON.stringify({ ok: false, description: "forced test failure" }));
          return;
        }
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
      telegram: { enabled: true, token: "fake-token-not-real", ownerChatId: "77" },
    },
  });
}

describe("telegram approval prompt dedup (sweep #66)", () => {
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

  it("the same pending id prompts the owner exactly once; a new id still prompts", async () => {
    const ch = makeChannel();
    const first = await ch.notifyOwnerApproval({ id: "p-1", tool: "exec", args: { c: 1 } });
    assert.equal(first.ok, true);
    const dup = await ch.notifyOwnerApproval({ id: "p-1", tool: "exec", args: { c: 1 } });
    assert.deepEqual(dup, { ok: false, reason: "already_prompted" });
    assert.equal(sends().length, 1, "duplicate emission must not re-prompt");
    const other = await ch.notifyOwnerApproval({ id: "p-2", tool: "exec", args: {} });
    assert.equal(other.ok, true);
    assert.equal(sends().length, 2);
  });

  it("a FAILED delivery does not latch — the prompt stays re-promptable", async () => {
    const ch = makeChannel();
    const start = sends().length;
    // sendMessage falls back HTML → plain, so BOTH attempts must fail for
    // the delivery to fail.
    failNext = 2;
    const failed = await ch.notifyOwnerApproval({ id: "p-retry", tool: "exec", args: {} });
    assert.equal(failed.ok, false);
    assert.notEqual(failed.reason, "already_prompted");
    const retry = await ch.notifyOwnerApproval({ id: "p-retry", tool: "exec", args: {} });
    assert.equal(retry.ok, true, "the loop's natural re-emission must succeed after a failed send");
    assert.equal(sends().length - start, 3, "two failed attempts + one delivered");
  });

  it("the >200 clear fires: memory stays bounded and an old id re-prompts by design", async () => {
    const ch = makeChannel();
    const start = sends().length;
    // The clear runs before the add but AFTER the has-check, so it fires on
    // the 202nd distinct prompt (size 201 > 200). Only afterward is an old
    // id forgotten.
    for (let i = 0; i < 202; i++) {
      const r = await ch.notifyOwnerApproval({ id: `bulk-${i}`, tool: "exec", args: {} });
      assert.equal(r.ok, true);
    }
    const again = await ch.notifyOwnerApproval({ id: "bulk-0", tool: "exec", args: {} });
    assert.equal(again.ok, true, "after the clear an old id must re-prompt");
    assert.equal(sends().length - start, 203);
  });
});
