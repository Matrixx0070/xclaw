/**
 * Alert state must never fall through to the operator's live `~/.xclaw`.
 *
 * `defaultStatePath()` was taught to honour `paths.configDir` (see
 * `test/alert-state-config-dir.test.mjs`), but the OTHER half of that `||`
 * stayed open: with no configDir it still resolved to `os.homedir()/.xclaw`.
 * A text-rule lint test guards inline configs in `test/`
 * (`alerter-test-isolation.test.mjs`), and by construction it cannot see the
 * remaining leaks, because every one of them arrives through src/ indirection:
 *
 *   health-watchdog.mjs:93  getSharedAlerter(cfgRef || {})
 *   scheduler.mjs:243       getSharedAlerter(job._cfg || {})
 *   eval-job.mjs:97         getSharedAlerter(cfg || {})
 *   doctor-job.mjs:62       getSharedAlerter(cfg || {})
 *
 * The damage is not cosmetic. `saveState()` does `history.slice(-100)`, so
 * every fixture entry EVICTS a real one 1:1; on 2026-08-28 the operator's file
 * held 100 entries of which zero were deliveries — 12 `cron:job`, 12
 * `enforcement:a.bundle_navigate_hook`, 12 `live-e2e:live.commit_gate` and 62
 * `self-deploy:*`, all fixture keys, all `skipped:"no_targets"` (the live
 * config HAS a telegram target, so a real caller could not have produced
 * them). Worse, `markSent()` persists `lastSent[key]` into the same file: a
 * non-production caller can stamp the live cooldown map and suppress a genuine
 * page for `cooldownMs`.
 *
 * A bare `{}` is never a real caller — `loadConfig()` stamps `paths.configDir`
 * unconditionally (src/config/load.mjs:187). So an unresolvable location means
 * keep state in memory and report `statePath: null`, rather than guess at the
 * home dir. Same shape, same reasoning as `appendCronEvent`'s `no_config`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAlerter } from "../src/alerting/alerts.mjs";

const HOME_STATE = path.join(os.homedir(), ".xclaw", "alert-state.json");
// An unknown channel is refused by deliverToChannel with NO network call, so
// the whole non-skipped path (results, markSent, saveState) runs offline.
const SINK = [{ channel: "sink", to: "x" }];

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-alert-scope-"));
}

function liveHistoryKeys() {
  try {
    return (JSON.parse(fs.readFileSync(HOME_STATE, "utf8")).history || []).map((e) => e.key);
  } catch {
    return [];
  }
}

describe("alert state honours the configured location", () => {
  it("persists under paths.configDir and reports where", async () => {
    const dir = tmpdir();
    try {
      const a = createAlerter({
        paths: { configDir: dir },
        alerting: { enabled: true, targets: SINK },
      });
      const want = path.join(dir, "alert-state.json");
      assert.equal(a.status().statePath, want);
      await a.send({ key: "scope:persisted", severity: "error", title: "t" });
      const state = JSON.parse(fs.readFileSync(want, "utf8"));
      assert.ok(
        state.history.some((e) => e.key === "scope:persisted"),
        "a scoped alerter writes its history to the configured dir",
      );
      assert.ok(state.lastSent["scope:persisted"] > 0, "…and its cooldown stamp");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an explicit alerting.statePath still wins over the config dir", () => {
    const dir = tmpdir();
    try {
      const explicit = path.join(dir, "elsewhere.json");
      const a = createAlerter({
        paths: { configDir: dir },
        alerting: { enabled: true, targets: SINK, statePath: explicit },
      });
      assert.equal(a.status().statePath, explicit);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a config-less alerter keeps state in memory, not in the live home dir", () => {
  it("reports statePath null for every bare cfg the src/ call sites can pass", () => {
    for (const bare of [undefined, {}, { alerting: { enabled: true, targets: SINK } }, { paths: {} }]) {
      const a = createAlerter(bare);
      assert.equal(
        a.status().statePath,
        null,
        `bare cfg ${JSON.stringify(bare)} must name no file`,
      );
    }
  });

  it("writes NOTHING to the operator's live alert-state.json", async () => {
    const before = liveHistoryKeys();
    const key = "alert-state-scope:must-not-persist";
    // every persisting branch: delivery, cooldown, no_targets, disabled, floor
    const a = createAlerter({ alerting: { enabled: true, targets: SINK } });
    await a.send({ key, severity: "error", title: "t" });
    await a.send({ key, severity: "error", title: "t" }); // cooldown branch
    await createAlerter({}).send({ key, severity: "error", title: "t" }); // no_targets
    await createAlerter({ alerting: { enabled: false } }).send({ key, severity: "error", title: "t" });
    await createAlerter({ alerting: { enabled: true, targets: SINK } }).send({
      key,
      severity: "info", // below the default minSeverity floor
      title: "t",
    });

    const after = liveHistoryKeys();
    assert.equal(
      after.includes(key),
      false,
      "the test suite wrote into the operator's live alert-state.json",
    );
    assert.deepEqual(after, before, "…and evicted none of its entries");
  });

  it("still behaves correctly without a file — cooldown and history are in memory", async () => {
    const a = createAlerter({ alerting: { enabled: true, targets: SINK } });
    const key = "scope:in-memory";
    const first = await a.send({ key, severity: "error", title: "t" });
    assert.equal(first.skipped, null, "delivery is attempted as normal");
    const dup = await a.send({ key, severity: "error", title: "t" });
    assert.equal(dup.skipped, "cooldown", "the cooldown still applies within the process");
    assert.ok(
      a.history(10).some((e) => e.key === key),
      "history is still readable — only its persistence is skipped",
    );
  });

  it("a config-less alerter does not inherit the live cooldown map", async () => {
    // Reading the operator's file is not destructive, but it couples a
    // fixture to live state: any key already on cooldown there would come
    // back `skipped:"cooldown"` here for reasons the test cannot see.
    const live = (() => {
      try {
        return JSON.parse(fs.readFileSync(HOME_STATE, "utf8")).lastSent || {};
      } catch {
        return {};
      }
    })();
    const a = createAlerter({ alerting: { enabled: true, targets: SINK } });
    assert.deepEqual(a.status().lastSent, {}, "starts from an empty cooldown map");
    for (const k of Object.keys(live)) {
      assert.equal(a.status().lastSent[k], undefined, `${k} leaked in from the live file`);
    }
  });
});
