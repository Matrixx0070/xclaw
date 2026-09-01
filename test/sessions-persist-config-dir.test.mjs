/**
 * sessions.json must live in the config dir that owns the instance.
 *
 * `defaultSessionsPath()` resolved `~/.xclaw/sessions.json` from
 * `os.homedir()` while production persist was import-time
 * `configureSessionPersist({})` (gateway never reconfigured it) and
 * doctor already had cfg in scope and did not thread it. Two
 * consequences, same class as v3.297.0 alert-state.json / v3.507.0
 * pairing.json:
 *
 *  1. Two xclaw instances on one host with different `paths.configDir`
 *     shared a single sessions.json, so instance B's bindings mixed
 *     with instance A's.
 *  2. The suite wrote into the operator's real `~/.xclaw/sessions.json`.
 *     Gate-wiring tests passed an explicit `path:` because of this —
 *     that override is evidence of the leak, not a fix.
 *
 * Home fallback is refused. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never
 * a real caller. Such a path is `null`. Gateway boot threads cfg so
 * live still persists under configDir (never drop the capability).
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  resolveSessionsPath,
  defaultSessionsPath,
  saveSessionState,
} from "../src/sessions/persist.mjs";
import {
  configureSessionPersist,
  createSession,
  sessionsPersistPath,
} from "../src/sessions/router.mjs";

const HOME_SESSIONS = path.join(os.homedir(), ".xclaw", "sessions.json");
const SAVED_SESSIONS_FILE = process.env.XCLAW_SESSIONS_FILE;
delete process.env.XCLAW_SESSIONS_FILE;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-sessions-cfg-"));
}

function waitSave() {
  return new Promise((r) => setTimeout(r, 350));
}

describe("sessions persist follows paths.configDir", () => {
  after(() => {
    configureSessionPersist({ enabled: false, load: false });
    if (SAVED_SESSIONS_FILE === undefined) delete process.env.XCLAW_SESSIONS_FILE;
    else process.env.XCLAW_SESSIONS_FILE = SAVED_SESSIONS_FILE;
  });

  test("resolves under the config dir, not the home dir", async () => {
    const dir = await tmpDir();
    const cfg = { paths: { configDir: dir } };
    assert.equal(resolveSessionsPath(cfg), path.join(dir, "sessions.json"));
    assert.equal(defaultSessionsPath(cfg), path.join(dir, "sessions.json"));
    configureSessionPersist({ cfg, load: false, enabled: true });
    assert.equal(sessionsPersistPath(), path.join(dir, "sessions.json"));
    assert.notEqual(resolveSessionsPath(cfg), HOME_SESSIONS);
  });

  test("a write lands in the config dir and never touches the home file", async () => {
    const dir = await tmpDir();
    const homeBefore = fs.existsSync(HOME_SESSIONS)
      ? fs.readFileSync(HOME_SESSIONS)
      : null;

    configureSessionPersist({
      cfg: { paths: { configDir: dir } },
      load: false,
      enabled: true,
    });
    const s = createSession({ id: "pin-508-write", title: "pin" });
    assert.equal(s.id, "pin-508-write");
    await waitSave();

    const written = JSON.parse(
      fs.readFileSync(path.join(dir, "sessions.json"), "utf8")
    );
    assert.ok(
      written.sessions.some((row) => row.id === "pin-508-write"),
      "store did not persist into paths.configDir"
    );

    const homeAfter = fs.existsSync(HOME_SESSIONS)
      ? fs.readFileSync(HOME_SESSIONS)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "store wrote the home sessions.json");
  });

  test("an explicit paths.sessionsFile still wins over the config dir", async () => {
    const dir = await tmpDir();
    const explicit = path.join(dir, "custom-sessions.json");
    const cfg = {
      paths: { configDir: dir, sessionsFile: explicit },
    };
    assert.equal(resolveSessionsPath(cfg), explicit);
    assert.equal(defaultSessionsPath(cfg), explicit);
    configureSessionPersist({ cfg, load: false, enabled: true });
    assert.equal(sessionsPersistPath(), explicit);
  });

  test("opts.path still wins over sessionsFile and configDir", async () => {
    const dir = await tmpDir();
    const explicit = path.join(dir, "via-opts.json");
    configureSessionPersist({
      path: explicit,
      cfg: { paths: { configDir: dir, sessionsFile: path.join(dir, "ignored.json") } },
      load: false,
      enabled: true,
    });
    assert.equal(sessionsPersistPath(), explicit);
  });

  test("with no configDir there is NO home fallback — it names no file and never writes home", async () => {
    assert.equal(resolveSessionsPath({}), null);
    assert.equal(resolveSessionsPath(), null);
    assert.equal(defaultSessionsPath({}), null);
    assert.notEqual(defaultSessionsPath({}), HOME_SESSIONS);

    const homeBefore = fs.existsSync(HOME_SESSIONS)
      ? fs.readFileSync(HOME_SESSIONS)
      : null;
    configureSessionPersist({ cfg: {}, load: false, enabled: true });
    assert.equal(sessionsPersistPath(), null);
    createSession({ id: "pin-508-mem", title: "mem" });
    await waitSave();
    assert.equal(
      saveSessionState(null, { sessions: [], bindings: {} }),
      undefined,
      "saveSessionState(null) must no-op, not dirname(null)"
    );
    const homeAfter = fs.existsSync(HOME_SESSIONS)
      ? fs.readFileSync(HOME_SESSIONS)
      : null;
    assert.deepEqual(homeAfter, homeBefore, "no-configDir store wrote the home file");
  });
});
