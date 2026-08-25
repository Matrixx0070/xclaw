/**
 * Channel pairing — the `approved` arm of WHO may command the bot.
 *
 * In dmPolicy:"pairing" mode the live channel handler admits a DM sender iff a
 * STATIC allowlist match OR an APPROVED pairing:
 *
 *   // src/channels/discord/index.mjs (telegram/index.mjs is the twin)
 *   const staticOk = isAllowed(channelId);
 *   const approved = pairing.isApproved("discord", authorId);
 *   if (!staticOk && !approved) { ...create pairing request...; return; }  // <- stops here
 *
 * The static arm is pinned elsewhere (isSenderIdAllowed sweep #21 / gateDiscord
 * sweep #23). This file pins the OTHER arm — isApproved — which had ZERO direct
 * test coverage: `grep -rn isApproved test/` returned nothing. account-pairing
 * tests a DIFFERENT system (account-links.mjs `/link` codes); pairing-routes
 * drives approve/revoke/pending through the HTTP handler but never isApproved.
 *
 * Why it matters (sweep #24, 3.206.0): mutating isApproved to `return true` —
 * every sender reads as approved — left the FULL suite green (3555/0). In pairing
 * mode that admits ANY DM sender to the agent: a total channel-auth bypass. The
 * two authz properties of this gate are pinned here: it is EXACT-match (an
 * embedding of an approved id must not pass, per sweep #21) and CHANNEL-SCOPED
 * (an approval on one channel must not admit the same id on another).
 *
 * This pins the pure store decision. The channel handler's `!staticOk &&
 * !approved` combination — that `approved` is actually consulted at the live
 * call site and admits the sender past the gate — is closed for Telegram by
 * `test/pairing-gate-wiring.test.mjs` (sweep #30, 3.212.0), which drives the real
 * handler through the mock-Bot-API webhook seam and observes admission. Discord
 * is the twin (`channels/discord/index.mjs` has the same composite gate but no
 * webhook-style seam) and stays the recorded next candidate.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createPairingStore } from "../src/pairing/pairing-store.mjs";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-pair-appr-"));
let seq = 0;
function freshStore() {
  return createPairingStore({ storePath: path.join(TMP, `p${seq++}.json`) });
}
function approveSender(store, channel, id) {
  const { code } = store.upsertPairingRequest({ channel, id });
  const r = store.approve(channel, String(code));
  assert.equal(r.ok, true, "test setup: approve must succeed");
}
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("channel pairing — isApproved (the approved arm)", () => {
  it("an approved sender reads as approved", () => {
    const store = freshStore();
    approveSender(store, "telegram", "555");
    assert.equal(store.isApproved("telegram", "555"), true);
  });

  it("a sender who was NEVER approved is denied", () => {
    // The proven mutation: `return true` here admits every un-paired DM sender.
    const store = freshStore();
    approveSender(store, "telegram", "555");
    assert.equal(
      store.isApproved("telegram", "999"),
      false,
      "an un-paired sender must be denied — approve-anyone is a full channel-auth bypass"
    );
  });

  it("approval is SCOPED to its channel (a telegram approval never admits discord)", () => {
    const store = freshStore();
    approveSender(store, "telegram", "555");
    assert.equal(
      store.isApproved("discord", "555"),
      false,
      "cross-channel approval leak: a discord sender must not ride a telegram approval"
    );
  });

  // Exact-match embedding negatives (#21): a value that CONTAINS or is a PREFIX
  // of an approved id is the only thing that separates includes/startsWith
  // weakenings from a real `===`.
  it("DENIES a superstring of an approved id (5551 vs 555)", () => {
    const store = freshStore();
    approveSender(store, "telegram", "555");
    assert.equal(store.isApproved("telegram", "5551"), false);
  });
  it("DENIES a prefix of an approved id (55 vs 555)", () => {
    const store = freshStore();
    approveSender(store, "telegram", "555");
    assert.equal(store.isApproved("telegram", "55"), false);
  });

  it("matches id identically whether passed as string or number", () => {
    // ids arrive as numbers from Telegram/Discord; String() on BOTH sides is
    // the match — a mutation dropping either coercion breaks numeric senders.
    const store = freshStore();
    approveSender(store, "telegram", "555");
    assert.equal(store.isApproved("telegram", 555), true);
    assert.equal(store.isApproved("telegram", 999), false);
  });

  it("revoke de-authorizes — isApproved flips back to false", () => {
    const store = freshStore();
    approveSender(store, "telegram", "555");
    assert.equal(store.isApproved("telegram", "555"), true);
    store.revoke("telegram", "555");
    assert.equal(
      store.isApproved("telegram", "555"),
      false,
      "a revoked sender must lose agent access"
    );
  });
});
