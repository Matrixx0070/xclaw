/**
 * W3b commit 2 — memory correction + objective preference write-back.
 *
 *   (3) xclaw_forget lets the agent delete durable memory that is wrong or
 *       obsolete. It fail-safes: no matcher → nothing removed.
 *   (4) The owner's mid-mission answer is mined for durable preferences
 *       ("always run tests", "never force-push") and appended to the owner
 *       preference store — mirroring job.mjs's on-success write-back.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createForgetTool,
  rememberNote,
  recallMemory,
} from "../src/memory/recall.mjs";
import { runObjective, STATE_FENCE } from "../src/agent/objective.mjs";

async function cfgTmp(extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-memtool-"));
  return { paths: { configDir: dir }, memory: { ...extra }, objectives: { progressEverySegments: 0 }, _dir: dir };
}
async function workDirTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "xclaw-memtool-wd-"));
}
function block(state) {
  return "```" + STATE_FENCE + "\n" + JSON.stringify(state) + "\n```";
}
const doneSeg = () => async () => ({
  text: block({ status: "done", criteria: [{ id: "c1", text: "t", done: true }] }),
  turns: 1,
  toolTrace: [{}],
  stopReason: "natural",
});
function prefPath(cfg) {
  return path.join(cfg._dir, "memory", "preferences.md");
}

describe("xclaw_forget tool", () => {
  it("removes memory by type and by contains, and no-ops without a matcher", async () => {
    const cfg = await cfgTmp();
    const wd = await workDirTmp();
    await rememberNote(cfg, wd, "outcome one about widgets", { type: "outcome", goal: "widgets" });
    await rememberNote(cfg, wd, "a plain note about gadgets", { type: "note", goal: "gadgets" });

    const tool = createForgetTool({ cfg, workingDir: wd });

    // no matcher → nothing removed (fail-safe, not a blind wipe)
    const noop = await tool.execute({});
    assert.equal(noop.removed, 0, "no matcher removes nothing");

    // remove by type
    const byType = await tool.execute({ type: "outcome" });
    assert.equal(byType.removed, 1, "the one outcome was removed");
    let r = await recallMemory(cfg, wd, { query: "widgets gadgets", limit: 20 });
    assert.equal(r.hits.filter((h) => h.type === "outcome").length, 0, "outcome gone");
    assert.ok(r.hits.some((h) => h.type === "note"), "note survives");

    // remove by contains
    const byText = await tool.execute({ contains: "gadgets" });
    assert.equal(byText.removed, 1, "the gadgets note was removed");
    r = await recallMemory(cfg, wd, { query: "gadgets", limit: 20 });
    assert.equal(r.hits.length, 0, "workspace memory now empty");

    await fs.rm(cfg._dir, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });
});

describe("objective preference write-back", () => {
  async function heldMission(cfg, wd, objective) {
    const first = await runObjective(cfg, { objective, workingDir: wd, runSegment: doneSeg(), notify: async () => {} });
    assert.equal(first.status, "awaiting_human", "held for approval");
    return first.id;
  }

  it("mines an owner answer for durable preferences on resume", async () => {
    const cfg = await cfgTmp();
    const wd = await workDirTmp();
    const id = await heldMission(cfg, wd, "tidy up the build scripts");
    await runObjective(cfg, {
      resumeId: id,
      answer: "always run the full test suite before shipping the code",
      runSegment: doneSeg(),
      notify: async () => {},
    });
    const prefs = await fs.readFile(prefPath(cfg), "utf8");
    assert.match(prefs, /always run the full test suite before shipping/i, "preference persisted");
    await fs.rm(cfg._dir, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });

  it("an approve-only answer yields no preference", async () => {
    const cfg = await cfgTmp();
    const wd = await workDirTmp();
    const id = await heldMission(cfg, wd, "index the archive");
    await runObjective(cfg, { resumeId: id, answer: "approve", runSegment: async () => { throw new Error("approve must not run a segment"); }, notify: async () => {} });
    // no preference file, or an empty one — either way, no approve line
    let prefs = "";
    try { prefs = await fs.readFile(prefPath(cfg), "utf8"); } catch { prefs = ""; }
    assert.doesNotMatch(prefs, /approve/i, "approve-only writes no preference");
    await fs.rm(cfg._dir, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });

  it("respects the preferenceWriteBack:false gate", async () => {
    const cfg = await cfgTmp({ preferenceWriteBack: false });
    const wd = await workDirTmp();
    const id = await heldMission(cfg, wd, "rotate the credentials doc");
    await runObjective(cfg, {
      resumeId: id,
      answer: "always encrypt secrets at rest from now on please",
      runSegment: doneSeg(),
      notify: async () => {},
    });
    let prefs = "";
    try { prefs = await fs.readFile(prefPath(cfg), "utf8"); } catch { prefs = ""; }
    assert.equal(prefs, "", "no preferences written when gated off");
    await fs.rm(cfg._dir, { recursive: true, force: true });
    await fs.rm(wd, { recursive: true, force: true });
  });
});
