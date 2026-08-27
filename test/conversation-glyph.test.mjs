/**
 * Conversation glyphs (spec §16.2) — pure planning rules per channel,
 * ack resolution chain, and the apply wrapper's fail-closed guards.
 * NOT wired to the live message tool in this binary (§16.3 is separate);
 * a test pins that absence.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import {
  ACK_FALLBACK,
  applyConversationGlyph,
  normalizeGlyph,
  planGlyphAction,
  resolveAckGlyph,
} from "../src/channels/conversation-glyph.mjs";

describe("conversation glyphs (spec §16.2)", () => {
  it("normalizeGlyph trims and stringifies; nullish is empty", () => {
    assert.equal(normalizeGlyph("  heart  "), "heart");
    assert.equal(normalizeGlyph(null), "");
    assert.equal(normalizeGlyph(undefined), "");
    assert.equal(normalizeGlyph(7), "7");
  });

  it("nextcloud only supports adding a non-empty glyph", () => {
    assert.deepEqual(planGlyphAction({ channel: "nextcloud", glyph: "heart" }), {
      ok: true,
      op: "add",
      emoji: "heart",
    });
    assert.equal(planGlyphAction({ channel: "nextcloud", glyph: "" }).ok, false);
    assert.equal(planGlyphAction({ channel: "nextcloud", glyph: "heart", remove: true }).ok, false);
  });

  it("imessage: known kinds remove; unknown kind or empty clears all", () => {
    assert.deepEqual(planGlyphAction({ channel: "imessage", glyph: "love", remove: true }), {
      ok: true,
      op: "remove",
      emoji: "love",
    });
    assert.deepEqual(planGlyphAction({ channel: "imessage", glyph: "heart", remove: true }), {
      ok: true,
      op: "clear-all",
    });
    assert.deepEqual(planGlyphAction({ channel: "imessage", glyph: "" }), {
      ok: true,
      op: "clear-all",
    });
    assert.deepEqual(planGlyphAction({ channel: "imessage", glyph: "laugh" }), {
      ok: true,
      op: "add",
      emoji: "laugh",
    });
  });

  it("whatsapp: one reaction per message — replace on add, clear-one on empty/remove", () => {
    assert.deepEqual(planGlyphAction({ channel: "whatsapp", glyph: "heart" }), {
      ok: true,
      op: "replace",
      emoji: "heart",
    });
    assert.deepEqual(planGlyphAction({ channel: "whatsapp", glyph: "" }), {
      ok: true,
      op: "clear-one",
    });
    assert.deepEqual(planGlyphAction({ channel: "whatsapp", glyph: "heart", remove: true }), {
      ok: true,
      op: "clear-one",
    });
  });

  it("feishu/lark: clearAll wins; remove and add both need a non-empty glyph", () => {
    for (const channel of ["feishu", "lark"]) {
      assert.deepEqual(planGlyphAction({ channel, glyph: "x", clearAll: true }), {
        ok: true,
        op: "clear-all",
      });
      assert.deepEqual(planGlyphAction({ channel, glyph: "", remove: true }), {
        ok: true,
        op: "clear-all",
      });
      assert.deepEqual(planGlyphAction({ channel, glyph: "x", remove: true }), {
        ok: true,
        op: "remove",
        emoji: "x",
      });
      assert.equal(planGlyphAction({ channel, glyph: "" }).ok, false);
    }
  });

  it("default channels (telegram/discord/…): add, remove, clear-all on empty", () => {
    assert.deepEqual(planGlyphAction({ channel: "telegram", glyph: "thumbsup" }), {
      ok: true,
      op: "add",
      emoji: "thumbsup",
    });
    assert.deepEqual(planGlyphAction({ channel: "discord", glyph: "x", remove: true }), {
      ok: true,
      op: "remove",
      emoji: "x",
    });
    assert.deepEqual(planGlyphAction({ channel: "slack", glyph: "  " }), {
      ok: true,
      op: "clear-all",
    });
  });

  it("resolveAckGlyph: off when unconfigured; configured > identity > eyes fallback", () => {
    assert.equal(ACK_FALLBACK, "eyes");
    assert.equal(resolveAckGlyph(), "");
    assert.equal(resolveAckGlyph({ ackConfig: null, identityGlyph: "robot" }), "");
    assert.equal(resolveAckGlyph({ ackConfig: "think" }), "think");
    assert.equal(resolveAckGlyph({ ackConfig: { emoji: "zap" }, identityGlyph: "robot" }), "zap");
    assert.equal(resolveAckGlyph({ ackConfig: { emoji: " " }, identityGlyph: "robot" }), "robot");
    assert.equal(resolveAckGlyph({ ackConfig: {} }), "eyes");
  });

  it("applyConversationGlyph: bad plan throws, missing adapter.react throws, plan reaches adapter", async () => {
    await assert.rejects(
      () => applyConversationGlyph({ adapter: { react: () => {} }, channel: "nextcloud", glyph: "" }),
      /only supports adding/,
    );
    await assert.rejects(
      () => applyConversationGlyph({ adapter: {}, channel: "telegram", glyph: "x" }),
      /has no react adapter/,
    );
    const calls = [];
    const out = await applyConversationGlyph({
      adapter: { react: (args) => (calls.push(args), "sent") },
      channel: "whatsapp",
      messageId: "msg-1",
      glyph: "heart",
    });
    assert.equal(out, "sent");
    assert.deepEqual(calls, [{ messageId: "msg-1", ok: true, op: "replace", emoji: "heart" }]);
  });

  it("wired ONLY through the react tool (spec §16.3, v3.265.0)", () => {
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { recursive: true })) {
        const f = `${dir}/${e}`;
        if (!f.endsWith(".mjs") || f.includes("conversation-glyph")) continue;
        if (fs.statSync(f).isFile() && fs.readFileSync(f, "utf8").includes("applyConversationGlyph")) {
          hits.push(f.slice(f.indexOf("src/")));
        }
      }
    };
    walk(new URL("../src", import.meta.url).pathname);
    assert.deepEqual(hits, ["src/channels/react-tool.mjs"]);
  });
});
