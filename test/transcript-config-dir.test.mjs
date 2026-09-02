/**
 * transcripts/ must live in the config dir that owns the instance.
 *
 * `transcriptDir()` resolved `~/.xclaw/transcripts` from
 * `os.homedir()` while production writers (`appendTranscript(cfg, ...)`
 * at agent/loop.mjs:2021) already had cfg in scope.
 * Two consequences, same class as v3.297.0 alert-state.json /
 * v3.539.0 objectives/:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single transcripts/ directory, so instance B replayed
 *     instance A's history.
 *  2. The suite wrote into the operator's real `~/.xclaw/transcripts`.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null`. `appendTranscript` still returns
 * `{ ok: true }` without persisting (do not `mkdir(null)`).
 * Honour existing `XCLAW_CONFIG_DIR`. Keep `cfg.paths?.transcriptsDir`.
 * No new env.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  transcriptDir,
  transcriptPath,
  appendTranscript,
  loadTranscriptHistory,
  listTranscripts,
} from "../src/sessions/transcript.mjs";

const HOME_TR = path.join(os.homedir(), ".xclaw", "transcripts");
const SAVED_CONFIG_DIR = process.env.XCLAW_CONFIG_DIR;
delete process.env.XCLAW_CONFIG_DIR;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-tr-cfg-"));
}

function homeTrListing() {
  try {
    return fs.readdirSync(HOME_TR).sort();
  } catch {
    return null;
  }
}

function resolverSlice() {
  const src = fs.readFileSync(
    new URL("../src/sessions/transcript.mjs", import.meta.url),
    "utf8"
  );
  const start = src.indexOf("export function transcriptDir");
  const end = src.indexOf("export function appendTranscript");
  assert.ok(start >= 0 && end > start, "resolver slice not found");
  return src.slice(start, end);
}

describe("transcripts follow paths.configDir", () => {
  after(() => {
    if (SAVED_CONFIG_DIR === undefined) delete process.env.XCLAW_CONFIG_DIR;
    else process.env.XCLAW_CONFIG_DIR = SAVED_CONFIG_DIR;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(transcriptDir(cfg), path.join(dir, "transcripts"));
    assert.notEqual(transcriptDir(cfg), HOME_TR);
    const override = path.join(dir, "custom-tr");
    assert.equal(
      transcriptDir({ paths: { transcriptsDir: override } }),
      path.join(override, "transcripts")
    );
  });

  test("a write lands in the config dir and never touches the home transcripts dir", async () => {
    const dir = await tmpDir();
    const homeBefore = homeTrListing();

    const cfg = { paths: { configDir: dir } };
    const rec = appendTranscript(cfg, "pin-sess", { role: "user", content: "pin-configDir" });
    assert.equal(rec.ok, true);
    const hist = loadTranscriptHistory(cfg, "pin-sess");
    assert.equal(hist.length, 1);
    assert.equal(hist[0].content, "pin-configDir");
    const listed = listTranscripts(cfg);
    assert.ok(listed.some((x) => x.sessionId === "pin-sess"));
    assert.ok(
      fs.existsSync(path.join(dir, "transcripts", "pin-sess.jsonl")),
      "transcript did not persist into paths.configDir"
    );

    assert.deepEqual(homeTrListing(), homeBefore, "transcripts wrote the home transcripts dir");
  });

  test("XCLAW_CONFIG_DIR still wins when no configDir", async () => {
    const dir = await tmpDir();
    process.env.XCLAW_CONFIG_DIR = dir;
    try {
      assert.equal(transcriptDir({}), path.join(dir, "transcripts"));
      const rec = appendTranscript({}, "pin-env", { role: "user", content: "pin-env" });
      assert.equal(rec.ok, true);
      assert.ok(fs.existsSync(path.join(dir, "transcripts", "pin-env.jsonl")));
    } finally {
      delete process.env.XCLAW_CONFIG_DIR;
    }
  });

  test("with no configDir there is NO home fallback — it names no dir and never writes home", async () => {
    assert.equal(transcriptDir({}), null);
    assert.equal(transcriptDir(), null);
    assert.equal(transcriptPath({}, "x"), null);
    assert.notEqual(transcriptDir({}), HOME_TR);

    const homeBefore = homeTrListing();
    const cwdNull = path.join(process.cwd(), "null");
    const cwdBefore = fs.existsSync(cwdNull);

    const rec = appendTranscript({}, "nope", { role: "user", content: "nope" });
    assert.equal(rec.ok, true);
    assert.deepEqual(loadTranscriptHistory({}, "nope"), []);
    assert.deepEqual(listTranscripts({}), []);

    assert.deepEqual(homeTrListing(), homeBefore, "no-configDir transcripts wrote home transcripts dir");
    assert.equal(fs.existsSync(cwdNull), cwdBefore, "no-configDir transcripts mkdir cwd/null");
  });

  test("resolver body does not home and does not honour XCLAW_STATE_DIR", () => {
    const slice = resolverSlice();
    assert.doesNotMatch(slice, /os\.homedir/);
    assert.doesNotMatch(slice, /XCLAW_STATE_DIR/);
    assert.match(slice, /paths\?\.configDir/);
    assert.match(slice, /XCLAW_CONFIG_DIR/);
  });
});
