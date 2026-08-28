/**
 * Cron log/store paths must obey `paths.configDir` (2026-08-28 incident).
 *
 * `loadConfig()` always stamps `cfg.paths.configDir`, and ~20 stores resolve
 * through it — which is what lets a test redirect its whole world into a temp
 * dir. `src/cron/logs.mjs` never read it: it went straight to
 * `os.homedir()/.xclaw`. So `test/cron-anchor-restart.test.mjs`, which DOES
 * scope itself correctly (`cfg: { paths: { configDir: mkdtemp() } }`), still
 * appended its fixture events — including `"error":"suite exploded"` — into
 * the OPERATOR'S live `~/.xclaw/cron-events.log`, 1031 lines of them. The
 * test was right; the module ignored it.
 *
 * The second half is the bare-cfg guard. `scheduler.mjs` calls
 * `appendCronEvent(job._cfg || {}, …)`, so a job whose cfg is null writes
 * through an empty object — which resolved to the live home too. A bare `{}`
 * is by construction never a real caller (load.mjs:187 sets paths
 * unconditionally), so it must write NOWHERE rather than guess. Precedent:
 * `src/providers/model-stats.mjs:27`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  cronEventsLogPath,
  doctorLogPath,
  appendCronEvent,
} from "../src/cron/logs.mjs";
import { legacyCronJsonFile } from "../src/cron/durable-jobs.mjs";

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cron-scope-"));
}

const HOME_XCLAW = path.join(os.homedir(), ".xclaw");

describe("cron log paths honour paths.configDir", () => {
  it("resolves every cron store under the configured dir, never the home dir", () => {
    const dir = tmpdir();
    try {
      const cfg = { paths: { configDir: dir } };
      assert.equal(cronEventsLogPath(cfg), path.join(dir, "cron-events.log"));
      assert.equal(doctorLogPath(cfg), path.join(dir, "doctor-cron.log"));
      assert.equal(legacyCronJsonFile(cfg), path.join(dir, "cron-jobs.json"));
      for (const p of [cronEventsLogPath(cfg), doctorLogPath(cfg), legacyCronJsonFile(cfg)]) {
        assert.equal(
          p.startsWith(HOME_XCLAW + path.sep),
          false,
          `${p} escaped into the operator's live config dir`,
        );
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explicit logPath still wins over the config dir", () => {
    const dir = tmpdir();
    try {
      const explicit = path.join(dir, "elsewhere.log");
      assert.equal(
        cronEventsLogPath({ paths: { configDir: dir }, cron: { logPath: explicit } }),
        explicit,
      );
      assert.equal(
        doctorLogPath({ paths: { configDir: dir }, doctor: { cron: { logPath: explicit } } }),
        explicit,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the doctor / eval / live-e2e writers resolve through the same root", async () => {
    // Each of these had a private `defaultLogPath()` hard-coded to the home
    // dir. The doctor one was worse than a scoping hazard: its READER
    // (`monitorCronLogs` → `doctorLogPath`) honoured `doctor.cron.logPath`
    // while the writer ignored it, so a configured log was written to one file
    // and tailed from another.
    const dir = tmpdir();
    try {
      const cfg = { paths: { configDir: dir } };
      const mods = {
        "../src/cron/doctor-job.mjs": "doctor-cron.log",
        "../src/cron/eval-job.mjs": "eval-cron.log",
        "../src/cron/live-e2e-job.mjs": "live-e2e-cron.log",
      };
      for (const [spec, file] of Object.entries(mods)) {
        const { defaultLogPath } = await import(new URL(spec, import.meta.url).href);
        assert.equal(defaultLogPath(cfg), path.join(dir, file), `${spec} escaped its config dir`);
      }
      const doctor = await import("../src/cron/doctor-job.mjs");
      const explicit = path.join(dir, "configured.log");
      assert.equal(
        doctor.defaultLogPath({ paths: { configDir: dir }, doctor: { cron: { logPath: explicit } } }),
        explicit,
        "the writer must honour the same doctor.cron.logPath the reader does",
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("evalCronStatus reports a log path without throwing, with or without a cfg", async () => {
    // Threading cfg through the writers nearly shipped a `ReferenceError`:
    // `evalCronStatus()` takes no `opts`, so `defaultLogPath(opts.cfg)` threw on
    // every call. The suite stayed green because three of its five callers
    // swallow it in a bare `catch {}` (dashboard, ops, doctor) — only
    // `GET /cron/eval` would have surfaced it, as a 500. Nothing exercised this
    // function at all, so call it directly.
    const { evalCronStatus } = await import("../src/cron/eval-job.mjs");
    assert.equal(evalCronStatus().logPath, path.join(HOME_XCLAW, "eval-cron.log"));
    const dir = tmpdir();
    try {
      assert.equal(
        evalCronStatus({ paths: { configDir: dir } }).logPath,
        path.join(dir, "eval-cron.log"),
        "the reported path must be the one the writer would use",
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("with no config at all it still falls back to the home dir (real CLI callers)", () => {
    // The fallback itself is correct — `xclaw cron monitor` run before any
    // config exists must still find the operator's log. Only WRITES are gated.
    assert.equal(cronEventsLogPath(), path.join(HOME_XCLAW, "cron-events.log"));
    assert.equal(doctorLogPath(), path.join(HOME_XCLAW, "doctor-cron.log"));
  });
});

describe("appendCronEvent refuses to write without a config", () => {
  it("writes into the configured dir and reports where", () => {
    const dir = tmpdir();
    try {
      const cfg = { paths: { configDir: dir } };
      const r = appendCronEvent(cfg, { type: "end", id: "scope-test", ok: true });
      assert.equal(r.skipped, null, "a scoped write is not skipped");
      assert.equal(r.path, path.join(dir, "cron-events.log"));
      const written = fs.readFileSync(r.path, "utf8").trim();
      assert.match(written, /"id":"scope-test"/);
      assert.match(written, /"at":"20/, "every event is timestamped");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a bare cfg writes NOWHERE — it does not fall through to the live home dir", () => {
    // scheduler.mjs:226/235 pass `job._cfg || {}`. Before the fix this landed
    // in the operator's production log; the guard makes it observable instead.
    for (const bare of [{}, null, undefined, { cron: {} }, { paths: {} }]) {
      const r = appendCronEvent(bare, { type: "end", id: "must-not-be-written" });
      assert.equal(r.skipped, "no_config", `bare cfg ${JSON.stringify(bare)} must skip`);
      assert.equal(r.path, null, "…and name no file");
    }
    const live = path.join(HOME_XCLAW, "cron-events.log");
    if (fs.existsSync(live)) {
      assert.equal(
        fs.readFileSync(live, "utf8").includes("must-not-be-written"),
        false,
        "the test suite wrote into the operator's live cron log",
      );
    }
  });

  it("an unwritable target is reported, not swallowed", () => {
    const r = appendCronEvent({ cron: { logPath: "/proc/self/mem/nope.log" } }, { type: "end" });
    assert.equal(r.skipped, "error", "a failed append is visible to its caller");
    assert.ok(r.error, "…with the reason attached");
  });
});
