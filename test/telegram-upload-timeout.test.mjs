/**
 * Media uploads must be bounded (sequel to v3.290.0).
 *
 * v3.290.0 bounded the JSON `api()` path with an AbortSignal because Node's
 * `fetch` has no total-request timeout: a connection that opens and then goes
 * silent parks the awaiting caller forever. It explicitly deferred the
 * multipart upload paths. Those are the *worse* case — a stalled upload holds
 * the whole reply, and photo-out's catch re-uploads the same buffer as a
 * document, so one wedged socket becomes two.
 *
 * A flat timeout is wrong for uploads: 30s is generous for a 40 KB voice note
 * and far too tight for a 40 MB document on a slow link. The budget is derived
 * from the payload size and clamped, so a pathological size cannot make it
 * unbounded again.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { telegramUploadTimeoutMs } from "../src/channels/telegram/errors.mjs";
import { sendPhotoFile, sendPhotoUrl } from "../src/channels/telegram/photo-out.mjs";
import { sendTelegramVoiceNote } from "../src/channels/telegram/voice-out.mjs";

const MB = 1024 * 1024;

/**
 * Resolve to the sentinel if `p` has not settled within `ms`.
 * A missing AbortSignal shows up here as HUNG instead of hanging the suite.
 */
async function raceHang(p, ms = 3_000) {
  let timer;
  const hang = new Promise((res) => {
    timer = setTimeout(() => res("HUNG"), ms);
  });
  try {
    return await Promise.race([p, hang]);
  } finally {
    clearTimeout(timer);
  }
}

/** A server that accepts the request and then never answers. */
function silentFetch(calls) {
  return (url, init) =>
    new Promise((_resolve, reject) => {
      calls.push({ url: String(url), init });
      const sig = init?.signal;
      // No signal => this promise never settles: exactly the production bug.
      if (!sig) return;
      if (sig.aborted) return reject(sig.reason);
      sig.addEventListener("abort", () => reject(sig.reason), { once: true });
    });
}

async function withSilentFetch(fn) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = silentFetch(calls);
  try {
    return { out: await fn(calls), calls };
  } finally {
    globalThis.fetch = real;
  }
}

describe("telegramUploadTimeoutMs: size-derived and clamped", () => {
  test("a zero-byte payload gets the base connect budget", () => {
    assert.equal(telegramUploadTimeoutMs(0), 30_000);
    assert.equal(telegramUploadTimeoutMs(undefined), 30_000);
  });

  test("garbage sizes fall back to the base rather than NaN", () => {
    for (const bad of [NaN, -1, "x", null, Infinity, {}]) {
      const ms = telegramUploadTimeoutMs(bad);
      assert.ok(Number.isFinite(ms), `${String(bad)} -> ${ms}`);
      assert.equal(ms, 30_000, `${String(bad)} -> ${ms}`);
    }
  });

  test("the budget grows with the payload", () => {
    const small = telegramUploadTimeoutMs(64 * 1024);
    const mid = telegramUploadTimeoutMs(8 * MB);
    const big = telegramUploadTimeoutMs(40 * MB);
    assert.ok(small < mid, `${small} < ${mid}`);
    assert.ok(mid < big, `${mid} < ${big}`);
    // Telegram's own 50 MB document ceiling must still fit under the clamp,
    // or a legitimate large upload would abort itself every time.
    assert.ok(telegramUploadTimeoutMs(50 * MB) < telegramUploadTimeoutMs(1e12));
  });

  test("a pathological size is clamped, never unbounded", () => {
    const huge = telegramUploadTimeoutMs(1e15);
    assert.ok(Number.isFinite(huge));
    assert.equal(huge, 600_000);
    assert.equal(telegramUploadTimeoutMs(Number.MAX_SAFE_INTEGER), 600_000);
  });

  test("callers can tune the model", () => {
    assert.equal(telegramUploadTimeoutMs(0, { baseMs: 5_000 }), 5_000);
    assert.equal(
      telegramUploadTimeoutMs(1024, { baseMs: 1_000, bytesPerSec: 1024 }),
      2_000
    );
    assert.equal(telegramUploadTimeoutMs(1e12, { baseMs: 1_000, maxMs: 9_000 }), 9_000);
    // A ceiling below the base is contradictory; the base wins so no caller
    // can configure an upload that aborts before it has finished connecting.
    assert.equal(telegramUploadTimeoutMs(1e12, { maxMs: 9_000 }), 30_000);
  });
});

describe("upload paths abort instead of parking forever", () => {
  test("sendPhotoUrl bounds its request", async () => {
    const { out } = await withSilentFetch(() =>
      raceHang(
        sendPhotoUrl({
          token: "T",
          chatId: 1,
          url: "https://example.invalid/a.png",
          timeoutMs: 40,
        })
      )
    );
    assert.notEqual(out, "HUNG", "sendPhotoUrl never returned — unbounded fetch");
    assert.equal(out.ok, false);
  });

  test("sendPhotoFile aborts and does NOT re-upload the same bytes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-upload-"));
    const p = path.join(dir, "shot.png");
    await fs.writeFile(p, Buffer.alloc(2048, 7));

    const { out, calls } = await withSilentFetch(() =>
      raceHang(
        sendPhotoFile({ token: "T", chatId: 1, filePath: p, timeoutMs: 40 })
      )
    );
    assert.notEqual(out, "HUNG", "sendPhotoFile never returned — unbounded fetch");
    assert.equal(out.ok, false);
    // A timeout is not a format rejection: falling back to sendDocument here
    // would push the identical buffer through a second wedged socket.
    assert.equal(calls.length, 1, `expected one request, saw ${calls.length}`);
    assert.match(calls[0].url, /sendPhoto$/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("sendTelegramVoiceNote bounds its request", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-upload-"));
    const p = path.join(dir, "voice.ogg");
    await fs.writeFile(p, Buffer.alloc(1024, 3));

    const { out } = await withSilentFetch(() =>
      raceHang(
        sendTelegramVoiceNote({
          token: "T",
          chatId: 1,
          filePath: p,
          format: "ogg",
          timeoutMs: 40,
        }).then(
          (r) => ({ settled: r }),
          (e) => ({ threw: String(e?.name || e) })
        )
      )
    );
    assert.notEqual(out, "HUNG", "sendTelegramVoiceNote never returned — unbounded fetch");
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("source pin: every media fetch carries a signal", () => {
  for (const rel of [
    "src/channels/telegram/photo-out.mjs",
    "src/channels/telegram/voice-out.mjs",
  ]) {
    test(`${rel} has no unbounded fetch`, async () => {
      const src = await fs.readFile(new URL(`../${rel}`, import.meta.url), "utf8");
      const fetches = src.match(/\bfetch\(/g) || [];
      const signals = src.match(/\bsignal:/g) || [];
      assert.ok(fetches.length > 0, "expected fetch call sites");
      assert.ok(
        signals.length >= fetches.length,
        `${fetches.length} fetch call(s) but only ${signals.length} signal(s)`
      );
    });
  }
});
