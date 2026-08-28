/**
 * The ops.tmp probe graded litter at the sweeper's own 24h retention bound,
 * which the sweeper cannot hold: it runs once a day, so a full interval of
 * entries ages past that bound between any two runs. The probe therefore
 * warned on the steady state — measured live at 3.312.0, 5,723 entries in the
 * 24-48h window against exactly one older than that — and, warning always,
 * read exactly the same during the six-day sweep outage in src/ops/due.mjs.
 *
 * These tests pin the distinction the old probe could not draw, through the
 * real sweeper rather than a stubbed count, so the max-age arithmetic the
 * doctor passes is covered along with the wording.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sweepStaleTmp, SWEEP_MAX_AGE_MS } from "../src/ops/tmp-sweeper.mjs";
import { tmpSweepProbe, tmpGradeAgeMs } from "../src/cli/doctor-tmp.mjs";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const dirs = [];

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

/** A tmpdir holding `count` sweepable entries, each backdated `ageHours`. */
function litter(count, ageHours) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-tmpprobe-"));
  dirs.push(dir);
  const t = (Date.now() - ageHours * HOUR) / 1000;
  for (let i = 0; i < count; i++) {
    const p = path.join(dir, `xclaw-litter-${i}`);
    fs.mkdirSync(p);
    fs.utimesSync(p, t, t);
  }
  return dir;
}

/** The doctor's own call shape, minus the config plumbing it cannot fixture. */
async function probe(tmpdir, { intervalMs = DAY, sweepEnabled = true } = {}) {
  const grade = { maxAgeMs: SWEEP_MAX_AGE_MS, intervalMs, sweepEnabled };
  const r = await sweepStaleTmp({}, { dryRun: true, tmpdir, maxAgeMs: tmpGradeAgeMs(grade) });
  return tmpSweepProbe({
    ...grade,
    unswept: r.removed.length,
    total: r.removed.length + r.kept + r.skippedReferenced.length,
  });
}

describe("doctor ops.tmp probe", () => {
  it("THE REGRESSION: litter waiting for the next daily sweep is not a fault", async () => {
    // 30h old: past the 24h retention bound, so the old probe warned — and yet
    // the next sweep has not come due, so nothing is wrong.
    const r = await probe(litter(60, 30));
    assert.equal(r.status, "ok", `steady state must not warn, got: ${r.message}`);
    assert.match(r.message, /60 xclaw tmp entries/);
    assert.match(r.message, /0 past a full sweep cycle/);
  });

  it("litter that outlived a full sweep cycle IS a fault, and names the cause", async () => {
    const r = await probe(litter(60, 60));
    assert.equal(r.status, "warn");
    assert.match(r.message, /60 of 60 .*outlived a full sweep cycle \(48h\)/);
    assert.match(r.message, /ops\.schedule/, "the sweep not running is that probe's finding");
  });

  it("grades on age, not volume: fresh litter never warns however much of it", async () => {
    const r = await probe(litter(200, 1));
    assert.equal(r.status, "ok");
    assert.match(r.message, /200 xclaw tmp entries, 0 past/);
  });

  it("a longer sweep interval widens the grace, because the sweep is what collects", async () => {
    const dir = litter(60, 60);
    assert.equal((await probe(dir, { intervalMs: DAY })).status, "warn");
    // Weekly sweep: the same 60h-old entries are still inside one cycle.
    assert.equal((await probe(dir, { intervalMs: 7 * DAY })).status, "ok");
  });

  it("with the sweep disabled it grades at the bare bound and offers the manual command", async () => {
    const grade = { maxAgeMs: SWEEP_MAX_AGE_MS, intervalMs: DAY, sweepEnabled: false };
    assert.equal(tmpGradeAgeMs(grade), SWEEP_MAX_AGE_MS, "no grace when nothing collects");
    const r = await probe(litter(60, 30), { sweepEnabled: false });
    assert.equal(r.status, "warn");
    assert.match(r.message, /sweep is disabled — run: xclaw sweep-tmp/);
  });

  it("only the disabled sweep is ever told to run the manual command", async () => {
    const r = await probe(litter(60, 60));
    assert.equal(r.status, "warn");
    assert.doesNotMatch(r.message, /xclaw sweep-tmp/, "the daily sweep already does this");
  });
});
