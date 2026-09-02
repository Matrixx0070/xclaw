/**
 * `telegram.lastError` must not warn after poll recovery.
 *
 * Live 2026-09-02 pid 3800483 (version 3.491.0): consecutivePollFails=0,
 * lastPollOkAt after lastPollErrorAt, lastError still
 * "Telegram getUpdates: The operation was aborted due to timeout".
 * Doctor listed telegram.lastError as the only warn. Watchdog already
 * treats that state as recovered (`detectPollOutage` false). A quiet bot
 * (messagesHandled=0) never hits the message-success `lastError = null`
 * path, so the leftover string was the only signal doctor consulted.
 *
 * Writer (`onPollOk`) now clears lastError. Reader
 * (`telegramLastErrorIsCurrent`) refuses to warn when poll recovery is
 * already stamped. Do not invert: a leftover lastError WITH
 * consecutivePollFails > 0, or with lastPollErrorAt after lastPollOkAt,
 * is still current.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { telegramLastErrorIsCurrent } from "../src/gateway/doctor.mjs";

const ROOT = path.dirname(fileURLToPath(new URL(".", import.meta.url)));

function doctorSlice() {
  const src = readFileSync(path.join(ROOT, "src/gateway/doctor.mjs"), "utf8");
  const start = src.indexOf("export function telegramLastErrorIsCurrent");
  const end = src.indexOf("export async function buildDoctorReport");
  assert.ok(start >= 0 && end > start, "predicate slice not found");
  return src.slice(start, end);
}

function onPollOkSlice() {
  const src = readFileSync(
    path.join(ROOT, "src/channels/telegram/index.mjs"),
    "utf8"
  );
  const start = src.indexOf("onPollOk:");
  const end = src.indexOf("onError:", start);
  assert.ok(start >= 0 && end > start, "onPollOk slice not found");
  return src.slice(start, end);
}

describe("telegramLastErrorIsCurrent", () => {
  test("recovered poller with leftover TIMEOUT is not current", () => {
    assert.equal(
      telegramLastErrorIsCurrent({
        lastError: "Telegram getUpdates: The operation was aborted due to timeout",
        consecutivePollFails: 0,
        lastPollOkAt: "2026-09-02T10:11:00.207Z",
        lastPollErrorAt: "2026-09-02T10:07:24.632Z",
        running: true,
      }),
      false
    );
  });

  test("consecutive fails keep the leftover current", () => {
    assert.equal(
      telegramLastErrorIsCurrent({
        lastError: "Telegram getUpdates: The operation was aborted due to timeout",
        consecutivePollFails: 1,
        lastPollOkAt: "2026-09-02T10:11:00.207Z",
        lastPollErrorAt: "2026-09-02T10:12:00.000Z",
        running: true,
      }),
      true
    );
  });

  test("error newer than ok with zero consecutive still current (in-flight fail)", () => {
    assert.equal(
      telegramLastErrorIsCurrent({
        lastError: "fetch failed",
        consecutivePollFails: 0,
        lastPollOkAt: "2026-09-02T10:00:00.000Z",
        lastPollErrorAt: "2026-09-02T10:05:00.000Z",
      }),
      true
    );
  });

  test("no lastError is never current", () => {
    assert.equal(telegramLastErrorIsCurrent({ lastError: null, consecutivePollFails: 3 }), false);
    assert.equal(telegramLastErrorIsCurrent(null), false);
    assert.equal(telegramLastErrorIsCurrent(undefined), false);
    assert.equal(telegramLastErrorIsCurrent({}), false);
  });

  test("ok stamp without an error stamp after recovery is not current", () => {
    assert.equal(
      telegramLastErrorIsCurrent({
        lastError: "stale",
        consecutivePollFails: 0,
        lastPollOkAt: "2026-09-02T10:11:00.207Z",
        lastPollErrorAt: null,
      }),
      false
    );
  });
});

describe("writer and reader stay aligned", () => {
  test("onPollOk clears lastError, not only consecutivePollFails", () => {
    const slice = onPollOkSlice();
    assert.match(slice, /consecutivePollFails\s*=\s*0/);
    assert.match(slice, /lastError\s*=\s*null/);
  });

  test("doctor keys telegram.lastError on telegramLastErrorIsCurrent, not the leftover string", () => {
    const src = readFileSync(path.join(ROOT, "src/gateway/doctor.mjs"), "utf8");
    assert.match(src, /if \(telegramLastErrorIsCurrent\(tgLive\)\)/);
    assert.doesNotMatch(
      src,
      /if \(tgLive\?\.lastError\) \{\s*push\("telegram\.lastError"/
    );
    const slice = doctorSlice();
    assert.match(slice, /consecutivePollFails/);
    assert.match(slice, /lastPollOkAt/);
    assert.match(slice, /lastPollErrorAt/);
  });
});
