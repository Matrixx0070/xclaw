/**
 * The self-deploy watcher must re-read config before it acts.
 *
 * `xclaw self-deploy watch` is the one xclaw process that outlives every
 * config edit. The gateway is restarted constantly (365 restarts on the live
 * box); the watcher is started once by the supervisor and then runs for weeks
 * — 14 days on the live box at the time of writing. It called `loadConfig()`
 * once, in the CLI, and every decision it made afterwards used that snapshot.
 *
 * The alerting target was added to `~/.xclaw/xclaw.json` after that boot, so
 * the watcher's alerter resolved zero targets and stayed that way: all 100
 * entries in the live alert history were `skipped: "no_targets"`, including
 * the `self-deploy:*` ones. That silences `deploying`/`deployed` (info, and no
 * loss), but it silences `rolled_back` and `ROLLBACK FAILED` too — those are
 * severity `error`, and the `no_targets` check in `send()` sits ABOVE the
 * severity check, so the one alert that says "the machine failed to redeploy
 * itself and needs a human" was dropped with the rest.
 *
 * `getSharedAlerter` already carries an upgrade-in-place path for exactly this
 * (a frozen target-less singleton), but it can only fire when a caller hands
 * it a config that DOES resolve targets. A caller that never gets a newer
 * config can never trigger the repair built for it.
 *
 * Gated on an intent being present, because `loadConfig()` logs on every call
 * and this loop ticks every 5s.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runDeployWatch, writeIntent } from "../src/self/deploy.mjs";

const TARGETS = [{ channel: "telegram", to: "1234" }];

async function bootCfg({ intent = true } = {}) {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-deploy-cfg-"));
  const cfg = { paths: { configDir }, alerting: {} };
  if (intent) {
    // "done" is a state runDeployOnce refuses, so even an unpatched watcher
    // that ignores the injected consumer cannot restart anything from here.
    await writeIntent(cfg, {
      v: 1,
      missionId: "m-refresh",
      state: "done",
      attempts: 0,
      mergeCommit: "0123456789abcdef",
    });
  }
  return cfg;
}

/** Run the watcher until it consumes once, or until the deadline. */
async function watchUntilConsumed(boot, opts, deadlineMs = 400) {
  const ac = new AbortController();
  const seen = [];
  const timer = setTimeout(() => ac.abort(), deadlineMs);
  try {
    await runDeployWatch(boot, {
      intervalMs: 1,
      signal: ac.signal,
      consume: async (cfg) => {
        seen.push(cfg);
        ac.abort();
        return null;
      },
      ...opts,
    });
  } finally {
    clearTimeout(timer);
  }
  return seen;
}

describe("self-deploy watcher config freshness", () => {
  test("acts on the reloaded config, not the one it booted with", async () => {
    const boot = await bootCfg();
    const fresh = { ...boot, alerting: { targets: TARGETS } };
    let reloads = 0;

    const seen = await watchUntilConsumed(boot, {
      reload: async () => {
        reloads += 1;
        return fresh;
      },
    });

    assert.ok(reloads >= 1, "watcher never re-read the config");
    assert.equal(seen.length, 1, "watcher never consumed the pending intent");
    assert.deepEqual(
      seen[0].alerting?.targets,
      TARGETS,
      "consumed with the boot config — a target added after boot never reaches the watcher"
    );
  });

  test("a config that fails to reload leaves the watcher running on the last good one", async () => {
    // A half-written xclaw.json must not take the deploy watcher down: it is
    // the component that recovers a failed deploy.
    const boot = await bootCfg();
    const seen = await watchUntilConsumed(boot, {
      reload: async () => {
        throw new Error("ENOENT: config vanished mid-deploy");
      },
    });

    assert.equal(seen.length, 1, "a failed reload stopped the watcher consuming");
    assert.equal(seen[0].paths.configDir, boot.paths.configDir, "did not fall back to the boot config");
  });

  test("an idle tick does not reload — loadConfig logs, and this loop ticks every 5s", async () => {
    const boot = await bootCfg({ intent: false });
    let reloads = 0;

    const seen = await watchUntilConsumed(
      boot,
      {
        reload: async () => {
          reloads += 1;
          return boot;
        },
      },
      120
    );

    assert.equal(seen.length, 0, "consumed with no intent present");
    assert.equal(reloads, 0, "reloaded config on an idle tick");
  });
});
