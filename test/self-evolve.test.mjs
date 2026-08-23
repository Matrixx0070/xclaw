import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  handsFreeConfigOverlay,
  handsFreeStatus,
  runEvolutionTick,
} from "../src/autonomy/self-evolve.mjs";
import { saveMidRunCheckpoint, markCheckpointResumed } from "../src/jobs/checkpoint.mjs";

describe("self-evolution / hands-free", () => {
  it("overlay enables heartbeat and evolve resume", () => {
    const o = handsFreeConfigOverlay();
    assert.equal(o.autonomy.level, "full");
    assert.equal(o.autonomy.heartbeat.enabled, true);
    assert.equal(o.autonomy.evolve.autoResume, true);
    assert.equal(o.autonomy.evolve.autoPromote, false);
    assert.equal(o.harness.groundHard, true);
  });

  it("auto-promote installs ONLY verified-evidence proposals (S8)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-promo-"));
    const cfg = {
      profile: "lab",
      paths: { configDir: tmp },
      autonomy: { level: "lab", evolve: { autoPromote: true } },
      skills: { dir: path.join(tmp, "skills") },
    };
    // Seed the review queue: one failure draft, one unverified success, one
    // verified success. Only the last may install.
    const pdir = path.join(tmp, "skill-proposals");
    await fs.mkdir(pdir, { recursive: true });
    const mk = (name, fm) =>
      fs.writeFile(
        path.join(pdir, name),
        `---\nname: ${name.replace(".md", "")}\nenabled: false\n${fm}\n---\n# draft\n`
      );
    await mk("a-fail.md", "source: failure");
    await mk("b-unverified.md", "source: success\nsourceVerdict: unverified");
    await mk("c-verified.md", "source: success\nsourceVerdict: verified");
    const out = await runEvolutionTick(cfg, { autoPromote: true, ownerApproved: true });
    const promoted = (out.actions || []).filter((a) => a.type === "promote");
    const skipped = (out.actions || []).filter((a) => a.type === "promote_skipped");
    assert.equal(skipped.length, 2, JSON.stringify(out.actions));
    assert.ok(
      skipped.every((a) => a.reason === "unverified_evidence"),
      "skips labeled with the evidence reason"
    );
    assert.ok(
      promoted.every((a) => String(a.path).includes("c-verified")),
      "only the verified proposal may install: " + JSON.stringify(promoted)
    );
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("status returns structure", async () => {
    const st = await handsFreeStatus({
      profile: "lab",
      autonomy: { level: "lab" },
    });
    assert.ok(st.level);
    assert.ok(Array.isArray(st.blockers));
    assert.ok(st.evolve);
  });

  it("dry-run tick does not throw", async () => {
    const r = await runEvolutionTick(
      { profile: "lab", autonomy: { level: "lab", evolve: { autoResume: true } } },
      { dryRun: true }
    );
    assert.ok(r.status);
    assert.ok(Array.isArray(r.actions));
  });
});

describe("self-evolution offline fixtures", () => {
  let cfg;
  let dir;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-evolve-fx-"));
    cfg = {
      profile: "lab",
      paths: { configDir: dir },
      autonomy: {
        level: "lab",
        evolve: { autoResume: true, autoPromote: false, maxAutoResume: 2 },
      },
    };
  });

  it("dry-run tick plans resume for running mid-run checkpoint", async () => {
    await saveMidRunCheckpoint(cfg, {
      id: "job_fx_run_1",
      goal: "fixture goal",
      workspace: path.join(dir, "ws"),
      turns: 3,
      maxTurns: 12,
    });
    const r = await runEvolutionTick(cfg, { dryRun: true });
    const resumes = r.actions.filter((a) => a.type === "resume");
    assert.ok(
      resumes.some((a) => a.id === "job_fx_run_1" && a.dryRun === true),
      `expected resume plan for job_fx_run_1, got ${JSON.stringify(r.actions)}`
    );
  });

  it("does not plan resume for already resumed checkpoint", async () => {
    await saveMidRunCheckpoint(cfg, {
      id: "job_fx_done_1",
      goal: "done",
      workspace: path.join(dir, "ws"),
      turns: 2,
      maxTurns: 10,
    });
    await markCheckpointResumed(cfg, "job_fx_done_1", {
      resumedBy: "job_fx_done_1_resume_x",
    });
    const r = await runEvolutionTick(cfg, { dryRun: true });
    const resumes = r.actions.filter(
      (a) => a.type === "resume" && a.id === "job_fx_done_1"
    );
    assert.equal(resumes.length, 0);
  });

  it("supervised level does not auto-resume", async () => {
    await saveMidRunCheckpoint(cfg, {
      id: "job_fx_sup_1",
      goal: "sup",
      workspace: path.join(dir, "ws"),
      turns: 1,
      maxTurns: 8,
    });
    const supervised = {
      ...cfg,
      autonomy: { ...cfg.autonomy, level: "supervised" },
    };
    const r = await runEvolutionTick(supervised, { dryRun: true });
    const resumes = r.actions.filter((a) => a.type === "resume");
    assert.equal(
      resumes.filter((a) => a.id === "job_fx_sup_1").length,
      0
    );
  });

  it("autoResume false skips resume phase", async () => {
    await saveMidRunCheckpoint(cfg, {
      id: "job_fx_block_1",
      goal: "blocked",
      workspace: path.join(dir, "ws"),
      turns: 1,
      maxTurns: 8,
    });
    const r = await runEvolutionTick(cfg, {
      dryRun: true,
      autoResume: false,
    });
    assert.equal(
      r.actions.filter((a) => a.type === "resume" && a.id === "job_fx_block_1")
        .length,
      0
    );
  });

  it("pending approval blocker skips resume", async () => {
    const { getSharedApprovalGate } = await import("../src/security/approvals.mjs");
    const gate = getSharedApprovalGate({
      security: {
        autoApprove: false,
        approvalPolicy: "risky",
        requireApproval: ["bash"],
        bindSystemRunPlan: false,
      },
    });
    // Seed a pending approval (non-blocking long timeout)
    const pendingPromise = gate.authorize("bash", { command: "echo fixture" }, {
      timeoutMs: 200,
    });
    // Give authorize a tick to register pending
    await new Promise((r) => setTimeout(r, 20));
    const pending = gate.listPending();
    assert.ok(pending.length >= 1, "expected pending approval");

    await saveMidRunCheckpoint(cfg, {
      id: "job_fx_apr_1",
      goal: "with approval",
      workspace: path.join(dir, "ws"),
      turns: 2,
      maxTurns: 10,
    });

    const r = await runEvolutionTick(cfg, { dryRun: true, autoResume: true });
    assert.ok(
      r.status.blockers.some((b) => b.kind === "approval"),
      `expected approval blocker, got ${JSON.stringify(r.status.blockers)}`
    );
    assert.equal(
      r.actions.filter((a) => a.type === "resume" && a.id === "job_fx_apr_1").length,
      0
    );

    // Cleanup: approve/deny so timers don't linger
    for (const p of gate.listPending()) {
      try {
        gate.decide(p.id, false, "test cleanup");
      } catch {
        /* */
      }
    }
    pendingPromise.catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
  });

  it("budget hard stop skips resume", async () => {
    await fs.writeFile(
      path.join(dir, "cost-governor.json"),
      JSON.stringify({
        day: new Date().toISOString().slice(0, 10),
        spentUsd: 99,
        jobs: 5,
        paused: true,
        events: [],
      })
    );
    await saveMidRunCheckpoint(cfg, {
      id: "job_fx_budget_1",
      goal: "budget",
      workspace: path.join(dir, "ws"),
      turns: 1,
      maxTurns: 8,
    });
    const r = await runEvolutionTick(
      {
        ...cfg,
        cost: { dailyHardUsd: 1, pauseQueueOnHard: true },
      },
      { dryRun: true, autoResume: true }
    );
    assert.ok(
      r.status.blockers.some((b) => b.kind === "budget"),
      `expected budget blocker, got ${JSON.stringify(r.status.blockers)}`
    );
    assert.equal(
      r.actions.filter((a) => a.type === "resume" && a.id === "job_fx_budget_1")
        .length,
      0
    );
  });
});
