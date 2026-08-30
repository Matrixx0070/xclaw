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
});
