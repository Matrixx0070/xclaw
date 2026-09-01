/**
 * PagerDuty webhook history must live in the config dir that owns the
 * alerting settings.
 *
 * `historyPath()` resolved `~/.xclaw/pd-webhook-events.jsonl` from
 * `os.homedir()` while the production handler already received `ctx.cfg`
 * (gateway/routes/alerts.mjs) and used it only for `shouldMirror`. Two
 * consequences, same class as v3.297.0 alert-state.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single JSONL, so instance B's events mixed with instance A's.
 *  2. The suite wrote into the operator's real `~/.xclaw/pd-webhook-events.jsonl`.
 *     `test/pagerduty-webhook-route-wiring.test.mjs` HOME-overrode because of
 *     this — that override is evidence of the leak, not a fix.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a handler keeps history in the in-memory ring and
 * reports `null`. Same shape as `defaultStatePath` in alerts.mjs.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  handlePagerDutyWebhook,
  getPagerDutyWebhookHistoryPath,
  listRecentPagerDutyWebhooks,
} from "../src/alerting/pagerduty-webhooks.mjs";

const HOME_HISTORY = path.join(os.homedir(), ".xclaw", "pd-webhook-events.jsonl");

const BODY = {
  event: {
    event_type: "incident.triggered",
    resource_type: "incident",
    data: { id: "PABC123", status: "triggered", title: "disk full" },
  },
};

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-pd-hist-"));
}

describe("pagerduty webhook history follows paths.configDir", () => {
  test("resolves under the config dir, not the home dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-pd-hist-"));
    const cfg = { paths: { configDir: dir } };
    assert.equal(
      getPagerDutyWebhookHistoryPath(cfg),
      path.join(dir, "pd-webhook-events.jsonl")
    );
    assert.notEqual(getPagerDutyWebhookHistoryPath(cfg), HOME_HISTORY);
  });

  test("a write lands in the config dir and never touches the home file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_HISTORY)
      ? fs.readFileSync(HOME_HISTORY)
      : null;

    const before = listRecentPagerDutyWebhooks(100).length;
    await handlePagerDutyWebhook(BODY, { cfg: { paths: { configDir: dir } } });
    assert.equal(listRecentPagerDutyWebhooks(100).length, before + 1);

    const written = fs.readFileSync(
      path.join(dir, "pd-webhook-events.jsonl"),
      "utf8"
    );
    assert.match(written, /PABC123/, "handler did not persist into paths.configDir");

    const homeAfter = fs.existsSync(HOME_HISTORY)
      ? fs.readFileSync(HOME_HISTORY)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "handler wrote the home pd-webhook-events.jsonl");
  });

  test("an explicit alerting.pagerduty.webhooks.historyPath still wins over the config dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-pd-hist-"));
    const explicit = path.join(dir, "custom.jsonl");
    const cfg = {
      paths: { configDir: dir },
      alerting: { pagerduty: { webhooks: { historyPath: explicit } } },
    };
    assert.equal(getPagerDutyWebhookHistoryPath(cfg), explicit);
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(getPagerDutyWebhookHistoryPath({}), null);
    assert.equal(getPagerDutyWebhookHistoryPath(), null);
    assert.notEqual(getPagerDutyWebhookHistoryPath(), HOME_HISTORY);

    const homeBefore = fs.existsSync(HOME_HISTORY)
      ? fs.readFileSync(HOME_HISTORY)
      : null;
    const before = listRecentPagerDutyWebhooks(100).length;
    await handlePagerDutyWebhook(BODY, {});
    assert.equal(
      listRecentPagerDutyWebhooks(100).length,
      before + 1,
      "in-memory ring still records the event"
    );
    const homeAfter = fs.existsSync(HOME_HISTORY)
      ? fs.readFileSync(HOME_HISTORY)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir handler wrote the home file");
  });
});
