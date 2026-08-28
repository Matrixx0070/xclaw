import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { humanMs, scheduleProbe } from "../src/cli/doctor-schedule.mjs";

const MIN = 60_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const NOW = 1_700_000_000_000;

describe("doctor schedule probe wording", () => {
  it("renders sub-hour ages in minutes, not as 0h", () => {
    assert.equal(humanMs(5 * MIN), "5m");
    assert.equal(humanMs(0), "0m");
    assert.equal(humanMs(90 * MIN), "1.5h");
    assert.equal(humanMs(DAY), "24h");
  });

  it("reports a healthy job by its age", () => {
    const r = scheduleProbe({
      status: { ran: true, ageMs: 4 * MIN, overdue: false },
      label: "approval digest",
      intervalMs: 5 * MIN,
      now: NOW,
    });
    assert.deepEqual(r, { status: "ok", message: "approval digest ran 4m ago" });
  });

  it("warns when a job is past twice its interval", () => {
    const r = scheduleProbe({
      status: { ran: true, ageMs: 3 * DAY, overdue: true },
      label: "eval suite",
      intervalMs: DAY,
      now: NOW,
    });
    assert.equal(r.status, "warn");
    assert.match(r.message, /eval suite last ran 72h ago \(interval 24h\)/);
  });

  // The three "never run yet" cases are the point of this module: before the
  // arm epoch they were one message, and that message claimed a first run was
  // imminent for a job that was in fact waiting out a full interval — or had
  // not started waiting at all.
  it("an unanchored job catches up shortly after boot", () => {
    const r = scheduleProbe({
      status: { ran: false },
      label: "daily ops job",
      intervalMs: DAY,
      now: NOW,
    });
    assert.equal(r.status, "ok");
    assert.equal(r.message, "never run yet (runs shortly after next gateway boot)");
  });

  it("an anchored job with no arm stamp says its clock has not started", () => {
    const r = scheduleProbe({
      status: { ran: false },
      label: "eval suite",
      intervalMs: DAY,
      anchored: true,
      now: NOW,
    });
    assert.equal(r.status, "ok");
    assert.equal(r.message, "never run yet (arms at next gateway boot, then waits one interval)");
    assert.doesNotMatch(r.message, /runs shortly/, "must not promise an imminent run");
  });

  it("an armed job reports the countdown, which is what survives restarts", () => {
    const r = scheduleProbe({
      status: { ran: false },
      label: "eval suite",
      intervalMs: DAY,
      anchored: true,
      armed: NOW - 90 * MIN,
      now: NOW,
    });
    assert.equal(r.status, "ok");
    assert.equal(r.message, "never run yet — armed 1.5h ago, first run in 22.5h");
  });

  it("an overdue arm stamp reports zero remaining, never a negative countdown", () => {
    const r = scheduleProbe({
      status: { ran: false },
      label: "eval suite",
      intervalMs: DAY,
      anchored: true,
      armed: NOW - 2 * DAY,
      now: NOW,
    });
    assert.match(r.message, /first run in 0m$/);
  });

  it("an arm stamp is ignored unless the job is anchored", () => {
    const r = scheduleProbe({
      status: { ran: false },
      label: "daily ops job",
      intervalMs: DAY,
      armed: NOW - HOUR,
      now: NOW,
    });
    assert.equal(r.message, "never run yet (runs shortly after next gateway boot)");
  });
});
