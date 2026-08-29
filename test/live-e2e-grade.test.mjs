/**
 * Regression cover for the live-e2e verdict.
 *
 * Two fail-opens lived in runLiveE2eCheck's inline grade:
 *   1. a signal-killed child (code === null) scored 1, which non-strict mode
 *      reads as "warnings only" — a suite that never finished reported the
 *      same verdict as one that finished with warnings;
 *   2. the `code === 1` soft-pass override applied even when stdout could not
 *      be parsed, so a missing scripts/live-enforcement-e2e.mjs (node exits 1,
 *      empty stdout) reported green forever having run zero checks.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gradeLiveE2e, CODE_SIGNAL } from "../src/cron/live-e2e-grade.mjs";
import { runLiveE2eCheck } from "../src/cron/live-e2e-job.mjs";

test("signal death is a hard failure, not a warnings pass", () => {
  const v = gradeLiveE2e({ code: CODE_SIGNAL, reportOk: false, parsed: false });
  assert.equal(v.ok, false);
  assert.equal(v.hardFail, true);
  assert.equal(v.reason, "signal");
});

test("CODE_SIGNAL stays outside the producer's own 0/1/2 range", () => {
  // live-enforcement-e2e.mjs computes `code = fails ? 2 : warns ? 1 : 0`, so a
  // substitute inside that range would be indistinguishable from a real verdict.
  assert.ok(CODE_SIGNAL >= 3, `CODE_SIGNAL must be >= 3, got ${CODE_SIGNAL}`);
});

test("an unparseable report is never rescued by the exit-1 override", () => {
  const v = gradeLiveE2e({ code: 1, reportOk: false, parsed: false });
  assert.equal(v.ok, false);
  assert.equal(v.reason, "unparseable");
});

test("a genuine warnings-only run still passes softly", () => {
  // The real producer emits ok:true with exit 1 when only warnings fired.
  assert.equal(gradeLiveE2e({ code: 1, reportOk: true, parsed: true }).ok, true);
  // And the override itself stays available for a parsed report.
  assert.equal(gradeLiveE2e({ code: 1, reportOk: false, parsed: true }).ok, true);
});

test("strict mode fails any non-zero exit", () => {
  assert.equal(gradeLiveE2e({ code: 1, reportOk: true, parsed: true, strict: true }).ok, false);
  assert.equal(gradeLiveE2e({ code: 0, reportOk: true, parsed: true, strict: true }).ok, true);
});

test("a clean run passes and a real failure fails", () => {
  assert.equal(gradeLiveE2e({ code: 0, reportOk: true, parsed: true }).ok, true);
  assert.equal(gradeLiveE2e({ code: 2, reportOk: false, parsed: true }).hardFail, true);
});

function tmpRoot(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `xclaw-live-e2e-${name}-`));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  return dir;
}

test("a missing live-enforcement-e2e.mjs is reported, not passed", async () => {
  const root = tmpRoot("missing");
  try {
    const r = await runLiveE2eCheck({
      root,
      logPath: path.join(root, "live-e2e.log"),
      notifyOnFail: false,
    });
    assert.equal(r.ok, false, "a run that executed zero checks must not be ok");
    assert.equal(r.reason, "unparseable");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a signal-killed suite is reported, not passed", async () => {
  const root = tmpRoot("signal");
  fs.writeFileSync(
    path.join(root, "scripts/live-enforcement-e2e.mjs"),
    "process.kill(process.pid, 'SIGKILL');\n"
  );
  try {
    const r = await runLiveE2eCheck({
      root,
      logPath: path.join(root, "live-e2e.log"),
      notifyOnFail: false,
    });
    assert.equal(r.ok, false, "a suite killed mid-run must not be ok");
    assert.equal(r.code, CODE_SIGNAL);
    assert.equal(r.reason, "signal");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a warnings-only suite still passes end to end", async () => {
  const root = tmpRoot("warn");
  fs.writeFileSync(
    path.join(root, "scripts/live-enforcement-e2e.mjs"),
    'console.log(JSON.stringify({ ok: true, fails: 0, warns: 1, results: [] }));\nprocess.exitCode = 1;\n'
  );
  try {
    const r = await runLiveE2eCheck({
      root,
      logPath: path.join(root, "live-e2e.log"),
      notifyOnFail: false,
    });
    assert.equal(r.ok, true);
    assert.equal(r.code, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stdout that parses to a non-object does not crash the run", async () => {
  // JSON.parse("null") succeeds and yields null; reading .ok off it throws a
  // TypeError that would reject the cron handler rather than report a verdict.
  const root = tmpRoot("nonobject");
  fs.writeFileSync(
    path.join(root, "scripts/live-enforcement-e2e.mjs"),
    'console.log("null");\nprocess.exitCode = 2;\n'
  );
  try {
    const r = await runLiveE2eCheck({
      root,
      logPath: path.join(root, "live-e2e.log"),
      notifyOnFail: false,
    });
    assert.equal(r.ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
