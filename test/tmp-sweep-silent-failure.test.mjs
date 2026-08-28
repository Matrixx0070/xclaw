/**
 * The tmp sweeper's error channel had no reader.
 *
 * sweepStaleTmp returns `{removed, kept, skippedReferenced, errors}`. Two of
 * its three callers dropped `errors` on the floor:
 *
 *  - reportOpsRun (src/ops/scheduler.mjs) printed one line, `removed N stale
 *    entries`, and only when N was non-zero. A sweep whose every `fs.rm`
 *    failed — a busy mount, a permission change, an immutable entry — removes
 *    nothing, so it printed NOTHING, which is byte-identical to what a clean
 *    host prints. Live evidence at 3.318.0: six `[xclaw:ops]` lines in
 *    thirteen days of gateway log, every one of them a removal count, not one
 *    error or census among them.
 *
 *  - the doctor's ops.tmp row summed `removed + kept + skippedReferenced` and
 *    never looked at `errors`. When the sweep cannot even readdir the tmpdir
 *    it returns those three empty and the error in the fourth field, so the
 *    row printed `0 xclaw tmp entries, 0 past a full sweep cycle` at status
 *    ok. A host whose tmpdir is unreadable graded as pristine.
 *
 * That second one is the inverse of the defect class the quota rows were fixed
 * for at 3.313.0: there a missing artifact was reported as a fault, here an
 * actual fault is reported as health. Both come from counting over a
 * denominator that was never measured. A sweep that could not look is not a
 * sweep that found nothing.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sweepStaleTmp, SWEEP_MAX_AGE_MS } from "../src/ops/tmp-sweeper.mjs";
import { tmpSweepProbe, tmpGradeAgeMs } from "../src/cli/doctor-tmp.mjs";
import { reportOpsRun } from "../src/ops/scheduler.mjs";

const DAY = 24 * 3600_000;
const dirs = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

/** Collect what an ops run would say to the operator. */
function capture(result) {
  const logs = [];
  const warns = [];
  reportOpsRun(result, (...a) => logs.push(a.join(" ")), (...a) => warns.push(a.join(" ")));
  return { logs, warns, all: logs.concat(warns).join("\n") };
}

describe("tmp sweep failures reach the operator", () => {
  it("reports the sweep census even when it removed nothing", () => {
    const out = capture({ ran: true, tmp: { removed: [], kept: 7, skippedReferenced: ["m1"], errors: [] } });
    assert.match(out.all, /tmp sweep/, "a pass that swept nothing must still say so");
    assert.match(out.all, /kept 7/);
    assert.match(out.all, /1 referenced/);
  });

  it("THE DEFECT: a sweep that failed on every entry is not silent", () => {
    const out = capture({
      ran: true,
      tmp: { removed: [], kept: 0, skippedReferenced: [], errors: ["xclaw-a: EBUSY: resource busy"] },
    });
    assert.match(out.warns.join("\n"), /EBUSY/, "the rm failure nobody printed");
    assert.notEqual(out.all, "", "a failing sweep must not look like a clean host");
  });

  it("still reports removals, and counts them", () => {
    const out = capture({ ran: true, tmp: { removed: ["a", "b", "c"], kept: 1, skippedReferenced: [], errors: [] } });
    assert.match(out.all, /removed 3/);
  });

  it("says nothing about a sweep that did not run (disabled)", () => {
    const out = capture({ ran: true, maintenance: { skipped: true } });
    assert.equal(out.all, "", "silence is reserved for a sweep that was never armed");
  });

  it("THE DEFECT: an unreadable tmpdir is not a clean host", async () => {
    const gone = path.join(os.tmpdir(), `xclaw-nonexistent-${process.pid}-${Date.now()}`);
    const r = await sweepStaleTmp({}, { dryRun: true, tmpdir: gone });
    assert.equal(r.errors.length, 1, "readdir failure must surface as an error");
    const p = tmpSweepProbe({
      maxAgeMs: SWEEP_MAX_AGE_MS,
      intervalMs: DAY,
      sweepEnabled: true,
      unswept: r.removed.length,
      total: r.removed.length + r.kept + r.skippedReferenced.length,
      errors: r.errors,
    });
    assert.equal(p.status, "warn", `an unreadable tmpdir must not grade ok: ${p.message}`);
    assert.doesNotMatch(p.message, /^0 xclaw tmp entries/, "never print a count taken over nothing");
  });

  it("an error outranks the sweep-disabled wording", () => {
    const p = tmpSweepProbe({
      maxAgeMs: SWEEP_MAX_AGE_MS,
      intervalMs: DAY,
      sweepEnabled: false,
      unswept: 0,
      total: 0,
      errors: ["EACCES: permission denied, scandir '/tmp'"],
    });
    assert.equal(p.status, "warn");
    assert.match(p.message, /EACCES/, "the operator needs the reason, not the policy");
  });

  it("names how many failures there were when there is more than one", () => {
    const p = tmpSweepProbe({
      maxAgeMs: SWEEP_MAX_AGE_MS,
      intervalMs: DAY,
      unswept: 0,
      total: 0,
      errors: ["a: EBUSY", "b: EBUSY", "c: EBUSY"],
    });
    assert.match(p.message, /2 more/, "one example plus a count, not a wall of text");
  });

  // The probe body lives inside runDoctor, which loads the real config and
  // cannot be pointed at a fixture — so the DECISION is pure and tested above,
  // and the WIRING is pinned here by reading the call site. Without this, the
  // doctor could stop handing the probe the field it grades and every test
  // above would stay green.
  it("the doctor hands the probe the errors it grades", () => {
    const src = fs.readFileSync(new URL("../src/cli/doctor.mjs", import.meta.url), "utf8");
    const call = src.slice(src.indexOf("tmpSweepProbe({"));
    assert.ok(call.startsWith("tmpSweepProbe({"), "ops.tmp must still call tmpSweepProbe");
    const args = call.slice(0, call.indexOf("});"));
    assert.match(args, /errors:/, "the sweep's error field must reach the probe");
  });

  it("a clean sweep still grades ok", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-sweeperr-"));
    dirs.push(dir);
    const r = await sweepStaleTmp({}, { dryRun: true, tmpdir: dir });
    const p = tmpSweepProbe({
      maxAgeMs: SWEEP_MAX_AGE_MS,
      intervalMs: DAY,
      unswept: r.removed.length,
      total: r.kept,
      errors: r.errors,
    });
    assert.equal(p.status, "ok", p.message);
  });
});
