/**
 * W3b — objective learning write-path.
 *
 * Two halves of one loop:
 *   (1) When a mission completes, a durable "outcome" memory is written to
 *       the mission's workspace (verdict embedded in the summary so it
 *       survives recall's projection, which does not surface a verdict
 *       field of its own).
 *   (2) A later mission with a similar goal recalls those outcomes and the
 *       first-segment prompt carries a "Lessons from past missions" block.
 *
 * Memory that is written but never read back changes no behaviour and is not
 * memory (the S7 lesson) — these pin both directions shut.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runObjective, buildSegmentPrompt, STATE_FENCE } from "../src/agent/objective.mjs";
import { newObjective } from "../src/agent/objective-store.mjs";
import { recallMemory } from "../src/memory/recall.mjs";

async function cfgTmp(extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-learn-"));
  return { paths: { configDir: dir }, objectives: { progressEverySegments: 0, ...extra }, _dir: dir };
}
async function workDirTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "xclaw-learn-wd-"));
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

// Drive a mission to a real "done" without any deterministic checks by
// approving the held completion — that is the owner-approve done-site, and
// the outcome wrapper must fire on it like every other done-path.
async function runToDone(cfg, objective, wd) {
  const first = await runObjective(cfg, { objective, workingDir: wd, runSegment: doneSeg(), notify: async () => {} });
  assert.equal(first.status, "awaiting_human", "held for approval");
  const done = await runObjective(cfg, {
    resumeId: first.id,
    answer: "approve",
    runSegment: async () => { throw new Error("approve must not run a segment"); },
    notify: async () => {},
  });
  assert.equal(done.status, "done");
  return done;
}

describe("objective learning write-path", () => {
  it("writes a durable outcome memory when a mission completes", async () => {
    const cfg = await cfgTmp();
    const wd = await workDirTmp();
    const done = await runToDone(cfg, "migrate the billing records to postgres", wd);
    assert.equal(done.objective.verdict, "owner-approved");

    const r = await recallMemory(cfg, wd, { query: "billing records postgres", limit: 8 });
    const outcome = r.hits.find((h) => h.type === "outcome");
    assert.ok(outcome, "an outcome memory was recorded");
    assert.match(String(outcome.summary), /owner-approved/, "verdict is embedded in the summary");
    assert.match(String(outcome.goal || outcome.summary), /billing records/i, "goal is captured");

    await fs.rm(cfg._dir, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });

  it("does not double-log the outcome on a re-run of an already-done mission", async () => {
    const cfg = await cfgTmp();
    const wd = await workDirTmp();
    const done = await runToDone(cfg, "index the archive", wd);
    // Re-enter runObjective on the finished mission — the idempotency flag
    // must suppress a second outcome write.
    await runObjective(cfg, { resumeId: done.id, runSegment: async () => { throw new Error("no segment on a done mission"); }, notify: async () => {} }).catch(() => {});
    const r = await recallMemory(cfg, wd, { query: "index archive", limit: 20 });
    const outcomes = r.hits.filter((h) => h.type === "outcome");
    assert.equal(outcomes.length, 1, "exactly one outcome memory");
    await fs.rm(cfg._dir, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });

  it("injects recalled lessons into the first-segment prompt of a later mission", async () => {
    const cfg = await cfgTmp();
    const wd = await workDirTmp();
    await runToDone(cfg, "deploy the notification service", wd);

    // Second mission, same workspace + similar goal — capture the first
    // segment's prompt.
    const prompts = [];
    await runObjective(cfg, {
      objective: "deploy the notification service again",
      workingDir: wd,
      runSegment: async ({ prompt }) => {
        prompts.push(prompt);
        return { text: block({ status: "continue" }), turns: 1, toolTrace: [{}], stopReason: "natural" };
      },
      notify: async () => {},
      // one segment then stop so the test terminates
      maxSegments: 1,
    }).catch(() => {});
    assert.ok(prompts.length >= 1, "a segment ran");
    assert.match(prompts[0], /Lessons from past missions/, "lessons block present");
    assert.match(prompts[0], /notification service/i, "the recalled goal is in the lessons");

    await fs.rm(cfg._dir, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });

  it("buildSegmentPrompt renders lessons only on the first segment", () => {
    const obj = newObjective({ objective: "x" });
    const withLessons = buildSegmentPrompt(obj, { firstSegment: true, lessons: "- prior mission verified [owner-approved]" });
    assert.match(withLessons, /Lessons from past missions/);
    assert.match(withLessons, /prior mission verified/);
    const later = buildSegmentPrompt(obj, { firstSegment: false, lessons: "- prior mission verified" });
    assert.doesNotMatch(later, /Lessons from past missions/, "no lessons block after the first segment");
  });
});
