import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyTelegramError,
  backoffMsFromClassification,
  telegramApiError,
} from "../src/channels/telegram/errors.mjs";
import {
  DICE_EMOJI,
  isValidDiceEmoji,
  normalizeDiceEmoji,
  extractCustomEmojiEntities,
  formatStickerEmojiLabel,
} from "../src/channels/telegram/emoji.mjs";
import {
  normalizeStickerMeta,
  stickerMetaToTextParts,
} from "../src/channels/telegram/sticker-meta.mjs";
import { runTelegramPollLoop } from "../src/channels/telegram/poll-loop.mjs";
import { extractStructuredInbound } from "../src/channels/telegram/structured-inbound.mjs";
import { payloadToApiCall } from "../src/channels/telegram/structured-outbound.mjs";

describe("telegram error classification", () => {
  it("classifies conflict and rate limit", () => {
    const c = classifyTelegramError(new Error("Conflict: terminated by other getUpdates"));
    assert.equal(c.code, "CONFLICT");
    assert.equal(c.retryable, true);

    const r = classifyTelegramError({
      message: "Too Many Requests: retry after 12",
      status: 429,
      parameters: { retry_after: 12 },
    });
    assert.equal(r.code, "RATE_LIMIT");
    assert.equal(r.retryAfterSec, 12);
    assert.ok(backoffMsFromClassification(r) >= 12000);
  });

  // Sweep #70: the 12s retry_after above lands INSIDE the 60s ceiling, so
  // removing the ceiling left the full suite green — a flood-control
  // retry_after of 3600 would sleep the live poll for an hour. Pin all
  // three backoff bounds with values strictly in each bound's active range.
  it("backoff bounds fire alone: 60s ceiling, 500ms floor, 30s exp cap", () => {
    assert.equal(
      backoffMsFromClassification({ retryAfterSec: 3600 }),
      60_000,
      "a huge retry_after must cap at 60s",
    );
    assert.equal(
      backoffMsFromClassification({ retryAfterSec: 0 }),
      500,
      "a zero retry_after must floor at 500ms (never busy-spin)",
    );
    const capped = backoffMsFromClassification({ retryable: true, retryAfterSec: null }, 20);
    assert.ok(capped >= 30_000 && capped < 31_000, `exp path must cap at 30s+jitter, got ${capped}`);
  });

  it("unauthorized is not retryable", () => {
    const u = classifyTelegramError(new Error("Unauthorized"));
    assert.equal(u.code, "UNAUTHORIZED");
    assert.equal(u.retryable, false);
  });

  it("telegramApiError carries retry_after", () => {
    const e = telegramApiError("sendMessage", {
      description: "rate",
      parameters: { retry_after: 3 },
    }, 429);
    assert.equal(e.retryAfter, 3);
  });
});

describe("emoji helpers", () => {
  it("validates dice emoji", () => {
    assert.ok(isValidDiceEmoji("🎲"));
    assert.equal(normalizeDiceEmoji("nope"), "🎲");
    assert.equal(DICE_EMOJI.length, 6);
  });

  it("extracts custom emoji entities", () => {
    const msg = {
      text: "hi X there",
      entities: [
        { type: "custom_emoji", offset: 3, length: 1, custom_emoji_id: "99" },
      ],
    };
    const items = extractCustomEmojiEntities(msg);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, "99");
  });

  it("formatStickerEmojiLabel", () => {
    assert.match(
      formatStickerEmojiLabel({ emoji: "🔥", set_name: "Hot", is_animated: true }),
      /🔥/
    );
  });
});

describe("sticker metadata", () => {
  it("normalizes full sticker fields", () => {
    const meta = normalizeStickerMeta({
      emoji: "🚀",
      set_name: "Space",
      file_id: "F",
      file_unique_id: "U",
      width: 512,
      height: 512,
      is_animated: true,
      custom_emoji_id: "CE",
      thumbnail: { file_id: "T", width: 128, height: 128 },
    });
    assert.equal(meta.emoji, "🚀");
    assert.equal(meta.fileUniqueId, "U");
    assert.equal(meta.customEmojiId, "CE");
    assert.ok(meta.thumbnail);
    assert.match(stickerMetaToTextParts(meta)[0], /animated/);
  });

  it("inbound uses rich sticker meta", () => {
    const { structured, textParts } = extractStructuredInbound({
      sticker: {
        emoji: "😀",
        set_name: "Smile",
        file_id: "X",
        file_unique_id: "Y",
        is_video: true,
      },
    });
    assert.equal(structured[0].fileUniqueId, "Y");
    assert.match(textParts[0], /video/);
  });
});

describe("outbound dice emoji", () => {
  it("forces valid dice emoji", () => {
    const call = payloadToApiCall({ type: "dice", emoji: "🙂" }, 1);
    assert.equal(call.body.emoji, "🎲");
  });
});

describe("poll loop", () => {
  it("processes updates and advances offset", async () => {
    let offset = 0;
    let calls = 0;
    const seen = [];
    let stopped = false;
    const api = async (method, body) => {
      calls += 1;
      if (method === "getUpdates") {
        if (calls === 1) {
          return [{ update_id: 10, message: { text: "hi" } }];
        }
        stopped = true;
        return [];
      }
      return {};
    };
    await runTelegramPollLoop({
      api,
      conf: { pollTimeoutSec: 1, pollLimit: 10 },
      isStopped: () => stopped,
      getOffset: () => offset,
      setOffset: (v) => {
        offset = v;
      },
      onUpdate: async (u) => {
        seen.push(u.update_id);
      },
    });
    assert.deepEqual(seen, [10]);
    assert.equal(offset, 11);
  });

  it("backs off on error then stops on unauthorized", async () => {
    let n = 0;
    const errors = [];
    await runTelegramPollLoop({
      api: async () => {
        n += 1;
        throw new Error("Unauthorized");
      },
      conf: { pollTimeoutSec: 1 },
      isStopped: () => false,
      getOffset: () => 0,
      setOffset: () => {},
      onError: (info) => errors.push(info.code),
    });
    assert.ok(errors.includes("UNAUTHORIZED"));
    assert.equal(n, 1);
  });
});
