/**
 * suggestion-feedback.json must live in the config dir that owns the instance.
 *
 * `baseDir()` resolved `~/.xclaw/suggestion-feedback.json` from `os.homedir()`
 * while production writers (`recordDurableSuggestionFeedback(cfg, …)` at
 * telegram/index.mjs:565/:934 inside `createTelegramChannel(cfg)`, and at
 * gateway/index.mjs:1492 inside `startGateway` after `loadConfig()`) already
 * had cfg in scope. Two consequences, same class as v3.297.0 alert-state.json
 * / v3.559.0 auth.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single suggestion-feedback.json, so instance B biased chips
 *     from instance A's tap history.
 *  2. The suite wrote into the operator's real `~/.xclaw`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `saveSuggestionFeedback` still no-ops
 * without persisting (do not `mkdir` dirname of null). `suggestionFeedbackPath`
 * on null returns null. `loadSuggestionFeedback` on null returns emptyStore().
 * Honour existing `XCLAW_CONFIG_DIR`. No extra path env. Do not invent
 * `XCLAW_SUGGESTION_FEEDBACK`.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  recordDurableSuggestionFeedback,
  loadSuggestionFeedback,
  saveSuggestionFeedback,
  suggestionFeedbackPath,
} from "../src/agent/suggestion-feedback.mjs";

const HOME_STORE = path.join(os.homedir(), ".xclaw", "suggestion-feedback.json");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-sugfb-cfg-"));
}

function homeListing() {
  try {
    return fs.readFileSync(HOME_STORE, "utf8");
  } catch {
    return null;
  }
}

function restoreEnv(key, saved) {
  if (saved === undefined) delete process.env[key];
  else process.env[key] = saved;
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/agent/suggestion-feedback.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("function baseDir");
  const end = src.indexOf("function keyOf");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

function pinCfg(dir) {
  return { paths: { configDir: dir }, auth: { durableWrites: false } };
}

const EV = {
  event: "shown",
  source: "pin",
  kind: "followup",
  prompt: "pin shown",
  suggestionId: "sug-pin-1",
};

describe("suggestion feedback follows paths.configDir", () => {
  after(() => {
    restoreEnv("XCLAW_CONFIG_DIR", SAVED_CONFIG_DIR);
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = pinCfg(dir);
    const data = await recordDurableSuggestionFeedback(cfg, EV);
    assert.ok(data);
    const fp = path.join(dir, "suggestion-feedback.json");
    assert.equal(suggestionFeedbackPath(cfg), fp);
    assert.ok(fs.existsSync(fp), "suggestion-feedback.json did not land in paths.configDir");
    assert.notEqual(fp, HOME_STORE);
  });

  test("a write lands in the config dir and never touches the home store", async () => {
    const dir = await tmpDir();
    const homeBefore = homeListing();

    const cfg = pinCfg(dir);
    await recordDurableSuggestionFeedback(cfg, EV);

    const stateFp = path.join(dir, "suggestion-feedback.json");
    assert.ok(
      fs.existsSync(stateFp),
      "suggestion-feedback.json did not persist into paths.configDir"
    );
    const body = fs.readFileSync(stateFp, "utf8");
    assert.match(body, /"shown":/);
    assert.match(body, /"pin\|followup"/);

    assert.equal(homeListing(), homeBefore, "suggestion-feedback wrote a home store");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      await recordDurableSuggestionFeedback({}, EV);
      assert.ok(fs.existsSync(path.join(dir, "suggestion-feedback.json")));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    const homeBefore = homeListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    assert.equal(suggestionFeedbackPath({}), null);
    const loaded = await loadSuggestionFeedback({});
    assert.equal(loaded.events.length, 0);

    // record still returns in-memory data after save no-ops; a second
    // load cannot observe a persisted store.
    const data = await recordDurableSuggestionFeedback({}, EV);
    assert.ok(data);
    assert.equal(data.keys["pin|followup"].shown, 1);
    const again = await loadSuggestionFeedback({});
    assert.equal(again.events.length, 0);

    const saved = await saveSuggestionFeedback({}, loaded);
    assert.equal(saved, null);

    assert.equal(homeListing(), homeBefore, "no-configDir suggestion-feedback wrote home");
    assert.equal(
      fs.existsSync(cwdNull),
      cwdBefore,
      "no-configDir suggestion-feedback mkdir cwd/null"
    );
  });

  test("resolver body does not home this store and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});
