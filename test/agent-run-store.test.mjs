import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  saveAgentRun,
  loadAgentRun,
  listAgentRuns,
  deleteAgentRun,
} from "../src/agent/run-store.mjs";

describe("agent run-store", () => {
  let cfg;
  before(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-runs-"));
    cfg = { paths: { configDir: dir } };
  });

  it("save and load", async () => {
    const wd = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-wd-"));
    await saveAgentRun(cfg, {
      sessionId: "sess_1",
      workingDir: wd,
      model: "grok-test",
      messages: [{ role: "user", content: "hi" }],
      turns: 1,
    });
    const out = await loadAgentRun(cfg, "sess_1");
    assert.equal(out.ok, true);
    assert.equal(out.run.model, "grok-test");
    assert.equal(out.run.messages.length, 1);
  });

  it("SESSION_NOT_FOUND", async () => {
    const out = await loadAgentRun(cfg, "missing");
    assert.equal(out.ok, false);
    assert.equal(out.code, "SESSION_NOT_FOUND");
  });

  it("SESSION_CORRUPT", async () => {
    const dir = cfg.paths.configDir;
    const fp = path.join(dir, "agent-runs", "bad.json");
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, "{not-json");
    const out = await loadAgentRun(cfg, "bad");
    assert.equal(out.ok, false);
    assert.equal(out.code, "SESSION_CORRUPT");
  });

  it("list and delete", async () => {
    const list = await listAgentRuns(cfg);
    assert.ok(list.some((r) => r.sessionId === "sess_1"));
    await deleteAgentRun(cfg, "sess_1");
    const out = await loadAgentRun(cfg, "sess_1");
    assert.equal(out.code, "SESSION_NOT_FOUND");
  });

  it("list marks maxTurns unfinished and natural complete", async () => {
    const wd = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-wd-"));
    await saveAgentRun(cfg, {
      sessionId: "cut_off",
      workingDir: wd,
      status: "maxTurns",
      stopReason: "maxTurns",
    });
    await saveAgentRun(cfg, {
      sessionId: "finished",
      workingDir: wd,
      status: "completed",
      stopReason: "natural",
    });
    const list = await listAgentRuns(cfg);
    const cut = list.find((r) => r.sessionId === "cut_off");
    const done = list.find((r) => r.sessionId === "finished");
    assert.equal(cut.ok, false);
    assert.equal(cut.resumable, true);
    assert.equal(done.ok, true);
    assert.equal(done.resumable, false);
  });

  it("list does not flag eval leftovers as resumable; owner interrupted still is", async () => {
    const isolated = { paths: { configDir: await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-runs-eval-")) } };
    const ownerWd = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-wd-owner-"));
    const evalRoot = path.join(os.tmpdir(), "xclaw-eval");
    await fs.mkdir(evalRoot, { recursive: true });
    const evalWd = await fs.mkdtemp(path.join(evalRoot, "leftover-"));
    await saveAgentRun(isolated, {
      sessionId: "eval_leftover_maxturns",
      workingDir: evalWd,
      status: "maxTurns",
      stopReason: "maxTurns",
    });
    await saveAgentRun(isolated, {
      sessionId: "owner_interrupted",
      workingDir: ownerWd,
      status: "interrupted",
      stopReason: "segment",
    });
    const list = await listAgentRuns(isolated);
    const leftover = list.find((r) => r.sessionId === "eval_leftover_maxturns");
    const owner = list.find((r) => r.sessionId === "owner_interrupted");
    assert.equal(leftover.resumable, false, "eval leftover must not be flagged resumable");
    assert.equal(leftover.ok, false);
    assert.equal(owner.resumable, true, "owner interrupted run must still be flagged resumable");
  });

  it("listAgentRuns uses isResumableAgentRun, not a re-derived heuristic", async () => {
    const src = await fs.readFile(new URL("../src/agent/run-store.mjs", import.meta.url), "utf8");
    assert.match(src, /isResumableAgentRun/);
    assert.doesNotMatch(
      src,
      /run\.status === "active" \|\|[\s\S]*run\.status === "interrupted"/
    );
  });
});
