import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { saveAgentRun, loadAgentRun } from "../src/agent/run-store.mjs";
import {
  isResumableAgentRun,
  goalFromAgentRun,
  reconcileInterruptedAgentRuns,
  resumeAgentRunAsObjective,
  reconcileAndResumeAgentRuns,
  listResumableAgentRuns,
} from "../src/agent/run-resume.mjs";
import { loadObjective } from "../src/agent/objective-store.mjs";

describe("isResumableAgentRun", () => {
  it("resumes crash-mid-loop and turn-cap cutoffs", () => {
    assert.equal(isResumableAgentRun({ status: "active", stopReason: "segment" }), true);
    assert.equal(isResumableAgentRun({ status: "interrupted", stopReason: "segment" }), true);
    assert.equal(isResumableAgentRun({ status: "maxTurns", stopReason: "maxTurns" }), true);
    assert.equal(isResumableAgentRun({ status: "active" }), true);
  });

  it("does not resume kill, approval, budget, or natural completion", () => {
    assert.equal(isResumableAgentRun({ status: "completed", stopReason: "natural" }), false);
    assert.equal(isResumableAgentRun({ status: "aborted", stopReason: "aborted" }), false);
    assert.equal(isResumableAgentRun({ status: "approval", stopReason: "approval" }), false);
    assert.equal(isResumableAgentRun({ status: "budget", stopReason: "budget" }), false);
    assert.equal(isResumableAgentRun({ status: "policy", stopReason: "policy" }), false);
    assert.equal(isResumableAgentRun({ status: "guard", stopReason: "guard" }), false);
    assert.equal(isResumableAgentRun({ status: "resumed", stopReason: "maxTurns" }), false);
  });

  it("does not resume a snapshot already promoted", () => {
    assert.equal(
      isResumableAgentRun({
        status: "interrupted",
        stopReason: "maxTurns",
        resumedAt: "2026-08-29T00:00:00.000Z",
        objectiveId: "obj_x",
      }),
      false
    );
  });

  it("does not resume eval leftovers under tmp/xclaw-eval", () => {
    const evalWd = path.join(os.tmpdir(), "xclaw-eval", "2026-08-30T03-23-54-655Z", "wc-a-04");
    assert.equal(
      isResumableAgentRun({
        status: "maxTurns",
        stopReason: "maxTurns",
        workingDir: evalWd,
        updatedAt: new Date().toISOString(),
      }),
      false
    );
    assert.equal(
      isResumableAgentRun({
        status: "interrupted",
        stopReason: "segment",
        workingDir: path.join(os.tmpdir(), "xclaw-eval", "run", "case"),
        updatedAt: new Date().toISOString(),
      }),
      false
    );
    assert.equal(
      isResumableAgentRun({
        status: "maxTurns",
        stopReason: "maxTurns",
        workingDir: path.join(os.tmpdir(), "xclaw-eval"),
        updatedAt: new Date().toISOString(),
      }),
      false
    );
    assert.equal(
      isResumableAgentRun({
        status: "interrupted",
        stopReason: "segment",
        workingDir: path.join(os.tmpdir(), "owner-work"),
        updatedAt: new Date().toISOString(),
      }),
      true
    );
  });

  it("does not resume stale snapshots past maxAgeMs", () => {
    const old = {
      status: "active",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    assert.equal(isResumableAgentRun(old, { now: Date.parse("2026-08-29"), maxAgeMs: 48 * 3600 * 1000 }), false);
    assert.equal(
      isResumableAgentRun(
        { status: "active", updatedAt: new Date().toISOString() },
        { maxAgeMs: 48 * 3600 * 1000 }
      ),
      true
    );
  });
});

describe("goalFromAgentRun", () => {
  it("prefers meta.goal over transcript notices", () => {
    assert.equal(
      goalFromAgentRun({
        meta: { goal: "write the report" },
        messages: [{ role: "user", content: "[XClaw notice] Turn checkpoint" }],
      }),
      "write the report"
    );
  });

  it("skips runtime notices when picking a user message", () => {
    assert.equal(
      goalFromAgentRun({
        messages: [
          { role: "user", content: "build the feature" },
          { role: "user", content: "[XClaw notice] Turn checkpoint (3/12 turns used)." },
        ],
      }),
      "build the feature"
    );
  });

  it("returns empty when nothing usable exists", () => {
    assert.equal(goalFromAgentRun({ messages: [{ role: "user", content: "[XClaw notice] x" }] }), "");
    assert.equal(goalFromAgentRun({}), "");
  });
});

describe("reconcile + resume agent-runs", () => {
  let cfg;
  let wd;
  before(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-run-resume-"));
    wd = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-run-wd-"));
    cfg = { paths: { configDir: dir } };
  });

  it("stamps active snapshots interrupted", async () => {
    await saveAgentRun(cfg, {
      sessionId: "crash_active",
      workingDir: wd,
      status: "active",
      stopReason: "segment",
      turns: 4,
      meta: { goal: "finish the patch" },
    });
    const ids = await reconcileInterruptedAgentRuns(cfg);
    assert.ok(ids.includes("crash_active"));
    const loaded = await loadAgentRun(cfg, "crash_active");
    assert.equal(loaded.run.status, "interrupted");
    assert.equal(loaded.run.stopReason, "segment");
  });

  it("promotes an interrupted cutoff into an objective and is idempotent", async () => {
    await saveAgentRun(cfg, {
      sessionId: "cap_hit",
      workingDir: wd,
      status: "maxTurns",
      stopReason: "maxTurns",
      turns: 12,
      meta: { goal: "analyse the whole repo" },
      messages: [{ role: "assistant", content: "Partial analysis so far." }],
      toolTrace: [{ artifacts: [{ type: "file", ref: "/tmp/notes.md" }] }],
    });
    const started = [];
    const first = await resumeAgentRunAsObjective(cfg, (await loadAgentRun(cfg, "cap_hit")).run, {
      start: async (obj) => {
        started.push(obj.id);
      },
    });
    assert.equal(first.ok, true);
    assert.ok(first.objectiveId);
    assert.equal(started.length, 1);
    const obj = await loadObjective(cfg, first.objectiveId);
    assert.equal(obj.objective, "analyse the whole repo");
    assert.ok(obj.progress.some((p) => /Recovered after process restart/.test(p)));
    assert.ok(obj.inspected.files.includes("/tmp/notes.md"));
    assert.ok(obj.inFlightSegment);

    const stamped = await loadAgentRun(cfg, "cap_hit");
    assert.equal(stamped.run.status, "resumed");
    assert.equal(stamped.run.objectiveId, first.objectiveId);

    const second = await resumeAgentRunAsObjective(cfg, stamped.run, {
      start: async () => {
        throw new Error("must not start twice");
      },
    });
    assert.equal(second.ok, false);
    assert.equal(second.reason, "not_resumable");
  });

  it("does not resume an aborted kill", async () => {
    await saveAgentRun(cfg, {
      sessionId: "killed",
      workingDir: wd,
      status: "aborted",
      stopReason: "aborted",
      meta: { goal: "do not continue this" },
    });
    const started = [];
    const out = await resumeAgentRunAsObjective(cfg, (await loadAgentRun(cfg, "killed")).run, {
      start: async (obj) => started.push(obj.id),
    });
    assert.equal(out.ok, false);
    assert.equal(started.length, 0);
  });

  it("reconcileAndResume honors autoResume:false and the max cap", async () => {
    await saveAgentRun(cfg, {
      sessionId: "cap_a",
      workingDir: wd,
      status: "maxTurns",
      stopReason: "maxTurns",
      meta: { goal: "one" },
    });
    await saveAgentRun(cfg, {
      sessionId: "cap_b",
      workingDir: wd,
      status: "maxTurns",
      stopReason: "maxTurns",
      meta: { goal: "two" },
    });
    const off = await reconcileAndResumeAgentRuns(
      { ...cfg, agent: { autoResume: false } },
      { start: async () => {} }
    );
    assert.equal(off.skipped, "autoResume_false");
    assert.equal(off.resumed.length, 0);

    const started = [];
    const on = await reconcileAndResumeAgentRuns(
      { ...cfg, agent: { autoResumeMax: 1 } },
      {
        start: async (obj) => started.push(obj.id),
      }
    );
    assert.equal(on.resumed.length, 1);
    assert.equal(started.length, 1);
    const still = await listResumableAgentRuns(cfg);
    assert.ok(still.length >= 1, "the uncapped leftover stays resumable");
  });

  it("does not auto-resume an eval leftover; owner interrupted still starts", async () => {
    const isolated = { paths: { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-run-resume-eval-")) } };
    const ownerWd = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-run-wd-owner-"));
    const evalRoot = path.join(os.tmpdir(), "xclaw-eval");
    await fs.mkdir(evalRoot, { recursive: true });
    const evalWd = await fs.mkdtemp(path.join(evalRoot, "leftover-"));
    await saveAgentRun(isolated, {
      sessionId: "eval_leftover_maxturns",
      workingDir: evalWd,
      status: "maxTurns",
      stopReason: "maxTurns",
      turns: 20,
      meta: { goal: "Please examine the two Excel files in the eval fixture" },
    });
    await saveAgentRun(isolated, {
      sessionId: "owner_interrupted",
      workingDir: ownerWd,
      status: "interrupted",
      stopReason: "segment",
      turns: 4,
      meta: { goal: "finish the owner patch" },
    });
    const started = [];
    const out = await reconcileAndResumeAgentRuns(isolated, {
      start: async (obj) => started.push({ id: obj.id, goal: obj.objective, workingDir: obj.workingDir }),
    });
    assert.equal(
      started.some((s) => s.workingDir === evalWd),
      false,
      "eval leftover must not be started"
    );
    assert.equal(
      started.some((s) => s.goal === "finish the owner patch"),
      true,
      "owner interrupted run must still start"
    );
    assert.equal(
      out.resumed.some((r) => r.sessionId === "eval_leftover_maxturns"),
      false
    );
    const leftover = await loadAgentRun(isolated, "eval_leftover_maxturns");
    assert.equal(leftover.run.status, "maxTurns");
    assert.equal(leftover.run.objectiveId || null, null);
    const owner = await loadAgentRun(isolated, "owner_interrupted");
    assert.equal(owner.run.status, "resumed");
  });

  it("listResumableAgentRuns finds an ISO owner id behind 80 job_* names", async () => {
    const isolated = {
      paths: { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-run-resume-lex-")) },
    };
    const ownerWd = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-run-wd-lex-owner-"));
    const fillerWd = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-run-wd-lex-filler-"));
    const evalRoot = path.join(os.tmpdir(), "xclaw-eval");
    await fs.mkdir(evalRoot, { recursive: true });
    const evalWd = await fs.mkdtemp(path.join(evalRoot, "lex-leftover-"));
    for (let i = 0; i < 81; i++) {
      const n = String(i).padStart(3, "0");
      await saveAgentRun(isolated, {
        sessionId: `job_zzzzzzzz_filler_${n}`,
        workingDir: fillerWd,
        status: "completed",
        stopReason: "natural",
        meta: { goal: `filler ${n}` },
      });
    }
    await saveAgentRun(isolated, {
      sessionId: "2026-08-30T03-23-54-655Z_owner-interrupted",
      workingDir: ownerWd,
      status: "interrupted",
      stopReason: "segment",
      turns: 4,
      meta: { goal: "finish the owner patch behind job_*" },
    });
    await saveAgentRun(isolated, {
      sessionId: "2026-08-30T03-23-54-655Z_intel-symbol-locate",
      workingDir: evalWd,
      status: "maxTurns",
      stopReason: "maxTurns",
      turns: 20,
      meta: { goal: "eval leftover must stay put" },
    });
    const dir = path.join(isolated.paths.configDir, "agent-runs");
    const ownerFp = path.join(dir, "2026-08-30T03-23-54-655Z_owner-interrupted.json");
    const leftoverFp = path.join(dir, "2026-08-30T03-23-54-655Z_intel-symbol-locate.json");
    const ownerBody = JSON.parse(await fs.readFile(ownerFp, "utf8"));
    const leftoverBody = JSON.parse(await fs.readFile(leftoverFp, "utf8"));
    ownerBody.updatedAt = "2026-08-30T08:40:00.000Z";
    leftoverBody.updatedAt = "2026-08-30T04:17:33.558Z";
    await fs.writeFile(ownerFp, JSON.stringify(ownerBody, null, 2));
    await fs.writeFile(leftoverFp, JSON.stringify(leftoverBody, null, 2));
    const names = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    names.sort();
    names.reverse();
    const lex80 = names.slice(0, 80).map((f) => f.replace(/\.json$/, ""));
    assert.equal(
      lex80.includes("2026-08-30T03-23-54-655Z_owner-interrupted"),
      false,
      "filename reverse-lex 80 must miss the ISO owner id"
    );
    const listed = await listResumableAgentRuns(isolated, { limit: 80 });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].sessionId, "2026-08-30T03-23-54-655Z_owner-interrupted");
    assert.equal(
      listed.some((r) => r.sessionId === "2026-08-30T03-23-54-655Z_intel-symbol-locate"),
      false,
      "eval leftover must not appear in the boot list"
    );
    const doctorWindow = await listResumableAgentRuns(isolated, { limit: 50 });
    assert.equal(doctorWindow.length, 1);
    assert.equal(doctorWindow[0].sessionId, "2026-08-30T03-23-54-655Z_owner-interrupted");
  });

  it("skips a snapshot with no recoverable goal", async () => {
    await saveAgentRun(cfg, {
      sessionId: "empty_goal",
      workingDir: wd,
      status: "active",
      messages: [{ role: "user", content: "[XClaw notice] Turn checkpoint" }],
    });
    const out = await resumeAgentRunAsObjective(cfg, (await loadAgentRun(cfg, "empty_goal")).run, {
      start: async () => {
        throw new Error("no start without a goal");
      },
    });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_goal");
  });
});
