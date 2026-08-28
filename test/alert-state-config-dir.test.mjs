/**
 * The alerter's state file must live in the config dir that owns the alerting
 * settings.
 *
 * `defaultStatePath()` resolved `~/.xclaw/alert-state.json` from `os.homedir()`
 * while ~40 sibling stores in src/ resolve `cfg?.paths?.configDir || <home>`.
 * Two consequences, one real and one that hid the first:
 *
 *  1. Alert state is cooldowns + delivery history. Two xclaw instances on one
 *     host with different `paths.configDir` shared a single cooldown map, so
 *     instance B's alert was suppressed as `cooldown` by instance A's — silent
 *     alert loss, the same class as the self-deploy watcher's stale config.
 *  2. The suite wrote into the OPERATOR's real `~/.xclaw/alert-state.json`.
 *     Confirmed by running `test/self-mod.test.mjs` — which correctly isolates
 *     `paths.configDir` — against the live box: the live file's sha256 changed
 *     (36286 -> 36047 bytes). Its 100 `no_targets` entries were therefore test
 *     output, not the deployer's, which is what made the live alert history
 *     unusable as forensic evidence.
 *
 * The home fallback was kept at first and has since been REMOVED — see the last
 * test in this file, and `test/alert-state-scope.test.mjs` for why.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAlerter } from "../src/alerting/alerts.mjs";

const HOME_STATE = path.join(os.homedir(), ".xclaw", "alert-state.json");

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-alert-state-"));
}

describe("alert state follows paths.configDir", () => {
  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const alerter = createAlerter({ paths: { configDir: dir }, alerting: { enabled: true } });

    assert.equal(alerter.status().statePath, path.join(dir, "alert-state.json"));
    assert.notEqual(alerter.status().statePath, HOME_STATE);
  });

  test("a write lands in the config dir and never touches the home file", async () => {
    const dir = await tmpDir();
    // Snapshot the operator's real file (if any) so a regression is caught as a
    // failed assertion here rather than as corrupted live state weeks later.
    const homeBefore = fs.existsSync(HOME_STATE) ? fs.readFileSync(HOME_STATE) : null;

    const alerter = createAlerter({ paths: { configDir: dir }, alerting: { enabled: true } });
    // No targets => send() records `no_targets` and persists. No network.
    const entry = await alerter.send({ key: "test:cfgdir", severity: "error", title: "t" });
    assert.equal(entry.skipped, "no_targets");

    const written = JSON.parse(fs.readFileSync(path.join(dir, "alert-state.json"), "utf8"));
    assert.ok(
      written.history.some((h) => h.key === "test:cfgdir"),
      "alerter did not persist into paths.configDir"
    );

    const homeAfter = fs.existsSync(HOME_STATE) ? fs.readFileSync(HOME_STATE) : null;
    assert.deepEqual(homeAfter, homeBefore, "alerter wrote the home alert-state.json");
  });

  test("an explicit alerting.statePath still wins over the config dir", async () => {
    const dir = await tmpDir();
    const explicit = path.join(await tmpDir(), "custom.json");
    const alerter = createAlerter({
      paths: { configDir: dir },
      alerting: { enabled: true, statePath: explicit },
    });
    assert.equal(alerter.status().statePath, explicit);
  });

  test("with no configDir there is NO home fallback — it names no file", () => {
    // This assertion is the reverse of what it pinned when written. The old
    // rationale was "a normal install has no paths.configDir", and that is
    // simply false: `loadConfig()` stamps `cfg.paths` unconditionally
    // (src/config/load.mjs:187), so every real caller arrives with one. What
    // actually reached the fallback was the bare-cfg indirection in src/ —
    // `getSharedAlerter(cfgRef || {})` and friends — i.e. the leak this pin was
    // meant to prevent. Guessing at the home dir is now refused outright;
    // `test/alert-state-scope.test.mjs` covers the behaviour that replaces it.
    assert.equal(createAlerter({ alerting: { enabled: true } }).status().statePath, null);
    assert.equal(createAlerter().status().statePath, null);
    assert.notEqual(createAlerter().status().statePath, HOME_STATE);
  });
});
