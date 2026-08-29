import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runLiveE2eCheck } from "../src/cron/live-e2e-job.mjs";
import { resetSharedAlerter } from "../src/alerting/alerts.mjs";
import { extractJsonReport } from "../src/cron/live-e2e-report.mjs";

function tmpRoot(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `xclaw-live-e2e-report-${name}-`));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  return dir;
}

function producer(dir, src) {
  fs.writeFileSync(path.join(dir, "scripts/live-enforcement-e2e.mjs"), src);
}

async function run(dir, opts = {}) {
  return runLiveE2eCheck({
    root: dir,
    logPath: path.join(dir, "cron.log"),
    notifyOnFail: false,
    ...opts,
  });
}

test("a report preceded by ambient log lines is still read", async () => {
  // The real producer imports src/config/load.mjs, which console.logs a
  // first-run banner, and src/computer/manager.mjs, which logs whenever it
  // starts or reuses the computer process. Those land on the same stdout as
  // the report. A whole-stream JSON.parse turns a byte-identical green report
  // into "unparseable" -- a nightly false alarm on any host that emits one.
  const dir = tmpRoot("noise");
  try {
    producer(
      dir,
      [
        'console.log("[xclaw] wrote default config to /root/.xclaw/xclaw.json");',
        'console.log("[xclaw] Computer already running on :4243");',
        'console.log(JSON.stringify({ ok: true, exitCode: 1, fails: 0, warns: 1, results: [] }, null, 2));',
        "process.exitCode = 1;",
      ].join("\n") + "\n"
    );
    const r = await run(dir);
    assert.equal(r.ok, true, `noise-prefixed report graded ${r.reason}`);
    assert.equal(r.code, 1);
    assert.equal(r.report.warns, 1, "the report itself must survive to the log and the alert");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a report followed by ambient log lines is still read", async () => {
  // src/computer/manager.mjs logs asynchronously, so a line can land AFTER the
  // report has been written.
  const dir = tmpRoot("trailing");
  try {
    producer(
      dir,
      [
        'console.log(JSON.stringify({ ok: true, fails: 0, warns: 0, results: [] }, null, 2));',
        'console.log("[xclaw] Computer exited code=0");',
      ].join("\n") + "\n"
    );
    const r = await run(dir);
    assert.equal(r.ok, true, `trailing-noise report graded ${r.reason}`);
    assert.equal(r.report.fails, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a green exit is not graded green unless the report was actually read", async () => {
  // exit 0 with unreadable stdout used to fabricate {ok: code === 0} and then
  // pass it: a producer that exits 0 without emitting a report scored the same
  // as one that ran every check.
  const dir = tmpRoot("exit0");
  try {
    producer(dir, 'console.log("not json at all");\n');
    const r = await run(dir);
    assert.equal(r.ok, false, "exit 0 with no readable report must not pass");
    assert.equal(r.reason, "unparseable");
    // The fallback must not claim a verdict it does not have. It used to
    // report ok: code === 0, i.e. "green" for a run it never observed.
    assert.equal(r.report.ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stdout that parses to an array is not treated as a report", async () => {
  // typeof [] === "object", so an array passed the old guard and then read
  // .ok as undefined -- which the grader treated as "not false", i.e. a pass.
  const dir = tmpRoot("array");
  try {
    producer(dir, 'console.log(JSON.stringify([{ ok: true }]));\n');
    const r = await run(dir);
    assert.equal(r.ok, false, "an array stdout must not pass as a report");
    assert.equal(r.reason, "unparseable");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the evidence tail survives into the log when the report cannot be read", async () => {
  const dir = tmpRoot("rawtail");
  const logPath = path.join(dir, "cron.log");
  try {
    producer(dir, 'console.log("SyntaxError: boom in live-enforcement-e2e");\nprocess.exitCode = 2;\n');
    await run(dir, { logPath });
    const log = fs.readFileSync(logPath, "utf8");
    assert.match(log, /SyntaxError: boom/, "the raw tail was collected and thrown away");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the report is taken from the file sink, not from stdout", async () => {
  // The out-of-band file is the channel; stdout is only the fallback for a
  // producer too old to know the flag. If the file is being ignored, this
  // run grades on the stdout decoy instead.
  const dir = tmpRoot("sink");
  try {
    producer(
      dir,
      [
        'import fs from "node:fs";',
        'const i = process.argv.indexOf("--json-out");',
        'fs.writeFileSync(process.argv[i + 1], JSON.stringify({ ok: true, fails: 0, warns: 0, results: [] }));',
        'console.log(JSON.stringify({ ok: false, fails: 9, warns: 0, results: [] }));',
      ].join("\n") + "\n"
    );
    const r = await run(dir);
    assert.equal(r.ok, true);
    assert.equal(r.report.fails, 0, "graded the stdout decoy instead of the file sink");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the alert says why it fired, not just that it did", async () => {
  // The false alarm this slice fixes produced an alert reading only "exit=1"
  // and a log path: no failing check, no reason, nothing an owner woken at
  // 04:00 could act on. The verdict has to travel with the alert.
  const dir = tmpRoot("alertreason");
  try {
    fs.writeFileSync(path.join(dir, "scripts/live-enforcement-e2e.mjs"), 'console.log("not a report");\n');
    resetSharedAlerter();
    const r = await runLiveE2eCheck({
      root: dir,
      logPath: path.join(dir, "cron.log"),
      // No targets: the alert is rendered and recorded, and delivered nowhere.
      cfg: {
        paths: { configDir: dir },
        alerting: { enabled: true, cooldownMs: 0, targets: [], minSeverity: "error" },
      },
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unparseable");
    assert.equal(r.notify.skipped, "no_targets");
    assert.match(r.notify.body, /reason=unparseable/);
    assert.equal(r.notify.meta.reason, "unparseable");
  } finally {
    resetSharedAlerter();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a trailing JSON blob does not outrank the real report", () => {
  // Last-one-wins was chosen because the report is the last thing the producer
  // writes. Nothing enforced that: any later object -- a debug dump from a
  // dependency -- silently became the verdict. Shape decides, position only
  // breaks ties.
  const real = { ok: false, exitCode: 2, fails: 3, warns: 0, results: [{ id: "x", status: "fail" }] };
  const text = `banner\n${JSON.stringify(real, null, 2)}\n[computer] exited\n{"ok":true,"note":"debug dump"}\n`;
  const r = extractJsonReport(text);
  assert.equal(r.parsed, true);
  assert.equal(r.report.ok, false);
  assert.equal(r.report.fails, 3);
});

test("noise carrying an unbalanced quote cannot hide the report", () => {
  // One scan over the whole stream carries string state across everything
  // ahead of the report. A single ambient line with an odd number of quotes
  // -- an error message rendering a raw " -- leaves the scanner believing it
  // is inside a string forever, and the report goes back to "unparseable":
  // the exact false alarm this module exists to stop.
  const real = { ok: true, exitCode: 0, fails: 0, warns: 0, results: [] };
  const text = `[computer] spawn failed: unterminated " quote\n${JSON.stringify(real, null, 2)}\n`;
  const r = extractJsonReport(text);
  assert.equal(r.parsed, true, "report lost behind a stray quote");
  assert.equal(r.report.ok, true);
});

test("extractJsonReport reads a report out of surrounding noise", () => {
  const rep = { ok: true, fails: 0, warns: 1, results: [] };
  const j = JSON.stringify(rep, null, 2);
  for (const text of [j, `[xclaw] banner\n${j}`, `${j}\n[xclaw] Computer exited`, `a\n${j}\nb`]) {
    const r = extractJsonReport(text);
    assert.equal(r.parsed, true, JSON.stringify(text).slice(0, 60));
    assert.deepEqual(r.report, rep);
  }
});

test("extractJsonReport is not fooled by braces inside strings", () => {
  const rep = { ok: true, note: "} { unbalanced \" quoted", results: [] };
  const r = extractJsonReport(`noise\n${JSON.stringify(rep)}\nnoise`);
  assert.equal(r.parsed, true);
  assert.deepEqual(r.report, rep);
});

test("extractJsonReport refuses anything that is not a report object", () => {
  // Well-formed JSON of the wrong shape is a producer answering the wrong
  // question. Digging an object out of an array would invent a verdict.
  for (const text of ["", "null", "3", '"str"', "[{\"ok\":true}]", "no json here", "{oops", undefined, null, 7]) {
    const r = extractJsonReport(text);
    assert.equal(r.parsed, false, JSON.stringify(text));
    assert.equal(r.report, null);
  }
});

test("extractJsonReport takes the last report when several are printed", () => {
  const r = extractJsonReport('{"ok":false,"fails":1}\n{"ok":true,"fails":0}');
  assert.equal(r.parsed, true);
  assert.equal(r.report.fails, 0);
});

test("a report read off stdout still grades, for a producer without the flag", () => {
  // scripts/live-enforcement-e2e.mjs takes flags with argv.includes, so an
  // older checkout ignores --json-out silently rather than failing. The
  // stdout fallback is what keeps that case working.
  const r = extractJsonReport('{"ok":true,"fails":0,"warns":0}');
  assert.equal(r.parsed, true);
  assert.equal(r.report.ok, true);
});
