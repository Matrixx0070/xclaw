/**
 * Trust Sprint — fail-closed completion gate for long-run objectives.
 *
 * The hole these tests pin shut (live benchmark F, 2026-08-23): an
 * objective with no typed verify checks completed on the model's own
 * narration — runDeterministicChecks returned {ok:true, ran:false} and the
 * gate was a no-op. An agent that spec-gamed a rigged migration (edited the
 * failing script, re-ran, declared success) reached status done with
 * nothing catching it.
 *
 * New contract: a mission may CLOSE only via (a) trusted deterministic
 * checks passing (api-provided or runtime-derived), or (b) the owner's
 * explicit "approve". Model-proposed checks can reject a completion but
 * never close one.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runObjective, STATE_FENCE } from "../src/agent/objective.mjs";
import { loadObjective, newObjective, saveObjective, mergeStateUpdate, ensureCounters } from "../src/agent/objective-store.mjs";
import { deriveVerifyChecks, baselineArmChecks, sanitizeModelVerifyChecks } from "../src/agent/objective-verify.mjs";

async function cfgTmp(extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-gate-"));
  return { paths: { configDir: dir }, objectives: { progressEverySegments: 0, ...extra }, _dir: dir };
}

async function workDirTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "xclaw-gate-wd-"));
}

function block(state) {
  return "```" + STATE_FENCE + "\n" + JSON.stringify(state) + "\n```";
}

const doneSeg = (extra = {}) => async () => ({
  text: block({ status: "done", criteria: [{ id: "c1", text: "t", done: true }], ...extra }),
  turns: 1,
  toolTrace: [{}],
  stopReason: "natural",
});

describe("fail-closed completion gate", () => {
  it("no checks: done is HELD awaiting the owner, never silently closed", async () => {
    const cfg = await cfgTmp();
    const wd = await workDirTmp(); // empty dir — nothing derivable
    const notes = [];
    const res = await runObjective(cfg, {
      objective: "migrate all the records",
      workingDir: wd,
      runSegment: doneSeg(),
      notify: async (t, m) => notes.push({ t, kind: m?.kind }),
    });
    assert.equal(res.status, "awaiting_human", "must hold, not close");
    const onDisk = await loadObjective(cfg, res.id);
    assert.equal(onDisk.status, "awaiting_human");
    assert.equal(onDisk.pendingCompletion?.reason, "no_checks");
    assert.equal(onDisk.verdict, "unverified");
    assert.ok(onDisk.finalAnswer == null || typeof onDisk.finalAnswer === "string");
    assert.ok(notes.some((n) => n.kind === "question"), "owner asked");
    await fs.rm(cfg._dir, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });

  it('owner "approve" closes the held completion as owner-approved', async () => {
    const cfg = await cfgTmp();
    const wd = await workDirTmp();
    const first = await runObjective(cfg, {
      objective: "do the thing",
      workingDir: wd,
      runSegment: doneSeg(),
      notify: async () => {},
    });
    assert.equal(first.status, "awaiting_human");
    const res = await runObjective(cfg, {
      resumeId: first.id,
      answer: "approve",
      runSegment: async () => {
        throw new Error("approve must not run another segment");
      },
      notify: async () => {},
    });
    assert.equal(res.status, "done");
    const onDisk = await loadObjective(cfg, res.id);
    assert.equal(onDisk.verdict, "owner-approved");
    assert.equal(onDisk.pendingCompletion, null);
    await fs.rm(cfg._dir, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });

  it("a non-approve answer clears the hold and continues the mission", async () => {
    const cfg = await cfgTmp();
    const wd = await workDirTmp();
    const first = await runObjective(cfg, {
      objective: "do the thing",
      workingDir: wd,
      runSegment: doneSeg(),
      notify: async () => {},
    });
    assert.equal(first.status, "awaiting_human");
    const prompts = [];
    const res = await runObjective(cfg, {
      resumeId: first.id,
      answer: "also verify the checksum file exists",
      runSegment: async ({ prompt }) => {
        prompts.push(prompt);
        // model proposes a model-sourced check that passes — still not trusted
        await fs.writeFile(path.join(wd, "out.txt"), "ok");
        return {
          text: block({
            status: "done",
            criteria: [{ id: "c1", text: "t", done: true }],
            verify: [{ type: "file_exists", path: "out.txt" }],
          }),
          turns: 1,
          toolTrace: [{}],
          stopReason: "natural",
        };
      },
      notify: async () => {},
    });
    assert.ok(prompts[0].includes("also verify the checksum"), "answer became the directive");
    assert.equal(res.status, "awaiting_human", "model-proposed checks alone never close");
    const onDisk = await loadObjective(cfg, res.id);
    assert.equal(onDisk.pendingCompletion?.reason, "model_checks_only");
    assert.equal(onDisk.verdict, "model-verified");
    assert.ok((onDisk.verify || []).some((c) => c.source === "model"), "model check merged");
    await fs.rm(cfg._dir, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });

  it("runtime-derived checks (baseline-passing) close the mission verified with NO owner tap", async () => {
    const cfg = await cfgTmp();
    const wd = await workDirTmp();
    await fs.writeFile(
      path.join(wd, "package.json"),
      JSON.stringify({ name: "demo", scripts: { test: "node -e \"process.exit(0)\"" } })
    );
    const res = await runObjective(cfg, {
      objective: "improve the demo project",
      workingDir: wd,
      runSegment: doneSeg(),
      notify: async () => {},
    });
    assert.equal(res.status, "done");
    const onDisk = await loadObjective(cfg, res.id);
    assert.equal(onDisk.verdict, "verified");
    assert.ok((onDisk.verify || []).some((c) => c.source === "runtime"), "runtime check armed");
    assert.equal(onDisk.verifyDeriveTried, true);
    await fs.rm(cfg._dir, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });

  it("a suite already red at mission start is dropped at baseline — and the gate STILL fails closed", async () => {
    const cfg = await cfgTmp();
    const wd = await workDirTmp();
    await fs.writeFile(
      path.join(wd, "package.json"),
      JSON.stringify({ name: "demo", scripts: { test: "node -e \"process.exit(1)\"" } })
    );
    const res = await runObjective(cfg, {
      objective: "work in a repo with a red suite",
      workingDir: wd,
      runSegment: doneSeg(),
      notify: async () => {},
    });
    assert.equal(res.status, "awaiting_human", "no armed checks → hold");
    const onDisk = await loadObjective(cfg, res.id);
    assert.equal(onDisk.pendingCompletion?.reason, "no_checks");
    assert.ok(!(onDisk.verify || []).length, "red-baseline check must not arm");
    await fs.rm(cfg._dir, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });

  it("requireChecked:false restores legacy narrated completion", async () => {
    const cfg = await cfgTmp({ requireChecked: false, deriveChecks: false });
    const res = await runObjective(cfg, {
      objective: "legacy mode",
      runSegment: doneSeg(),
      notify: async () => {},
    });
    assert.equal(res.status, "done");
    const onDisk = await loadObjective(cfg, res.id);
    assert.equal(onDisk.verdict, "unverified");
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("failing TRUSTED checks still reject → fix directive → escalate (E-A path intact)", async () => {
    const cfg = await cfgTmp();
    const wd = await workDirTmp();
    let segs = 0;
    const res = await runObjective(cfg, {
      objective: "make missing.txt",
      workingDir: wd,
      verify: [{ type: "file_exists", path: "missing.txt" }],
      runSegment: async () => {
        segs += 1;
        return doneSeg()();
      },
      notify: async () => {},
    });
    assert.equal(res.status, "awaiting_human");
    const onDisk = await loadObjective(cfg, res.id);
    assert.match(onDisk.humanQuestion || "", /verification still failing/i);
    assert.equal(onDisk.counters.verifyGateFails, 2, "both fix attempts persisted");
    assert.equal(segs, 3, "actor got 2 fix directives before escalation");
    await fs.rm(cfg._dir, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });
});

describe("persisted recovery counters + in-flight marker", () => {
  it("recovery budget survives a restart (counters live in the objective JSON)", async () => {
    const cfg = await cfgTmp({ requireChecked: false, deriveChecks: false });
    // First run: segment crashes twice → recovery burned (cap 1) → interrupted
    const first = await runObjective(cfg, {
      objective: "crashy mission",
      runSegment: async () => {
        throw new Error("boom");
      },
      notify: async () => {},
    });
    assert.equal(first.status, "interrupted");
    let onDisk = await loadObjective(cfg, first.id);
    assert.equal(onDisk.counters.recoveries, 1, "recovery spent and persisted");
    // Resume ("restart"): counters must NOT reset — the next crash goes
    // straight to interrupted without a fresh free retry loop forever.
    const second = await runObjective(cfg, {
      resumeId: first.id,
      runSegment: async () => {
        throw new Error("boom again");
      },
      notify: async () => {},
    });
    assert.equal(second.status, "interrupted");
    onDisk = await loadObjective(cfg, first.id);
    assert.equal(onDisk.counters.recoveries, 1, "no counter reset on resume");
    assert.equal(onDisk.failures.length >= 2, true);
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("a mid-flight interruption is surfaced to the next segment", async () => {
    const cfg = await cfgTmp({ requireChecked: false, deriveChecks: false });
    const obj = newObjective({ objective: "interrupted mid-segment" });
    ensureCounters(obj);
    obj.status = "interrupted";
    obj.inFlightSegment = { n: 3, startedAt: new Date().toISOString() };
    await saveObjective(cfg, obj);
    const prompts = [];
    const res = await runObjective(cfg, {
      resumeId: obj.id,
      runSegment: async ({ prompt }) => {
        prompts.push(prompt);
        return doneSeg()();
      },
      notify: async () => {},
    });
    assert.equal(res.status, "done");
    assert.match(prompts[0], /interrupted mid-flight/, "next segment warned about partial work");
    const onDisk = await loadObjective(cfg, obj.id);
    assert.equal(onDisk.inFlightSegment, null);
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });
});

describe("verify derivation + model-check sanitization", () => {
  it("derives npm test/lint from package.json scripts", async () => {
    const wd = await workDirTmp();
    await fs.writeFile(
      path.join(wd, "package.json"),
      JSON.stringify({ scripts: { test: "echo t", lint: "echo l" } })
    );
    const checks = await deriveVerifyChecks(wd);
    assert.equal(checks.length, 2);
    assert.ok(checks.every((c) => c.source === "runtime" && c.type === "command"));
    await fs.rm(wd, { recursive: true, force: true });
  });

  it("baselineArmChecks drops red checks and keeps green ones", async () => {
    const wd = await workDirTmp();
    const { armed, dropped } = await baselineArmChecks(wd, [
      { type: "command", cmd: "true", source: "runtime" },
      { type: "command", cmd: "false", source: "runtime" },
    ]);
    assert.equal(armed.length, 1);
    assert.equal(dropped.length, 1);
    await fs.rm(wd, { recursive: true, force: true });
  });

  it("model checks: write commands dropped, read-only kept, unknown types dropped, capped", () => {
    const out = sanitizeModelVerifyChecks([
      { type: "command", cmd: "rm -rf /tmp/x" }, // side effect → dropped
      { type: "command", cmd: "cat out.txt" }, // read-only → kept
      { type: "eval_js", code: "1" }, // unknown type → dropped
      { type: "file_exists", path: "a.txt" },
      { type: "file_contains" }, // no path → dropped
      { type: "text_contains", text: "ok", haystack: "ok" },
    ]);
    assert.deepEqual(
      out.map((c) => c.type).sort(),
      ["command", "file_exists", "text_contains"]
    );
    assert.ok(out.every((c) => c.source === "model"));
    const many = sanitizeModelVerifyChecks(
      Array.from({ length: 30 }, (_, i) => ({ type: "file_exists", path: `f${i}` }))
    );
    assert.ok(many.length <= 12, "model checks capped");
  });

  it("mergeStateUpdate stamps model provenance and dedupes", () => {
    const obj = newObjective({ objective: "x" });
    mergeStateUpdate(obj, { verify: [{ type: "file_exists", path: "a" }] });
    mergeStateUpdate(obj, { verify: [{ type: "file_exists", path: "a" }, { type: "file_exists", path: "b" }] });
    assert.equal(obj.verify.length, 2);
    assert.ok(obj.verify.every((c) => c.source === "model"));
  });
});

// Live obj_mt8e2yrr (2026-08-25): a 1-tool-call mission with a PASSING
// file_equals check ended awaiting_human because the model emitted no state
// block and its prose was under 40 chars — the deterministic gate was never
// consulted. Checks now waive the prose-length heuristic.
describe("terse no-state-block completion with passing api checks", () => {
  it("closes verified on a natural stop with passing checks and no prose", async () => {
    const { default: fsn } = await import("node:fs");
    const cfg = await cfgTmp();
    const wd = await workDirTmp();
    fsn.writeFileSync(path.join(wd, "w3.txt"), "proof");
    const res = await runObjective(cfg, {
      objective: "create w3.txt with proof",
      workingDir: wd,
      verify: [{ type: "file_equals", path: "w3.txt", content: "proof" }],
      runSegment: async () => ({
        text: "Done.", // < 40 chars, NO state block — the live shape
        turns: 1,
        toolTrace: [{}],
        stopReason: "natural",
      }),
      notify: async () => {},
    });
    assert.equal(res.status, "done", "passing checks must close the mission");
    const onDisk = await loadObjective(cfg, res.id);
    assert.equal(onDisk.verdict, "verified", "closure earned by checks, not prose");
    await fs.rm(cfg._dir, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });

  it("failing checks still never close on a terse natural stop", async () => {
    const cfg = await cfgTmp();
    const wd = await workDirTmp(); // file absent → check fails
    const res = await runObjective(cfg, {
      objective: "create w3.txt with proof",
      workingDir: wd,
      verify: [{ type: "file_equals", path: "w3.txt", content: "proof" }],
      runSegment: async () => ({
        text: "Done.",
        turns: 1,
        toolTrace: [{}],
        stopReason: "natural",
      }),
      notify: async () => {},
    });
    assert.notEqual(res.status, "done", "failing checks must not close");
    const onDisk = await loadObjective(cfg, res.id);
    assert.notEqual(onDisk.verdict, "verified");
    await fs.rm(cfg._dir, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });
});
