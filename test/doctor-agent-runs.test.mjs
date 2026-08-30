import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveAgentRun } from "../src/agent/run-store.mjs";
import { listResumableAgentRuns } from "../src/agent/run-resume.mjs";

describe("doctor sees unfinished agent-runs", () => {
  it("doctor.mjs probes listResumableAgentRuns", () => {
    const src = fs.readFileSync(new URL("../src/cli/doctor.mjs", import.meta.url), "utf8");
    assert.match(src, /agentRuns\.attention/);
    assert.match(src, /listResumableAgentRuns/);
  });

  it("Control does not claim auto-resume for not-ok-only snapshots", () => {
    const src = fs.readFileSync(new URL("../ui/control/app.js", import.meta.url), "utf8");
    assert.match(src, /stay put \(not auto-resumed\)/);
    assert.match(src, /list\.filter\(\(r\) => r\.resumable\)/);
  });

  it("an interrupted snapshot shows up as resumable for the probe", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-doc-runs-"));
    const wd = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-doc-wd-"));
    const cfg = { paths: { configDir: dir } };
    await saveAgentRun(cfg, {
      sessionId: "stuck_run",
      workingDir: wd,
      status: "maxTurns",
      stopReason: "maxTurns",
      meta: { goal: "keep going" },
    });
    const runs = await listResumableAgentRuns(cfg);
    assert.ok(runs.some((r) => r.sessionId === "stuck_run"));
  });
});
