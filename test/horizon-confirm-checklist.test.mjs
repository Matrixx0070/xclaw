import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  runConfirmChecklist,
  resetChecklistMetrics,
  getChecklistOk,
  readChecklistResult,
  checklistEvidencePath,
} from "../src/eval/horizon-confirm-checklist.mjs";
import { doctorHorizon } from "../src/cli/doctor-horizon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("confirm-live checklist", () => {
  it("dry-run: scorecard then g10-g14 dry, ok", async () => {
    resetChecklistMetrics();
    const prev = process.env.XCLAW_SOAK_CONFIRM;
    delete process.env.XCLAW_SOAK_CONFIRM;
    const r = await runConfirmChecklist({ spend: false, root });
    process.env.XCLAW_SOAK_CONFIRM = prev;
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.code, "DRY_OK");
    assert.ok(r.steps.some((s) => s.name === "scorecard" && s.ok));
    assert.ok(r.steps.some((s) => s.name === "g10_g14_dry_run" && s.ok));
    assert.equal(getChecklistOk(), 1);
    const ev = await readChecklistResult({ base: root });
    assert.equal(ev.ok, true);
    assert.equal(ev.result.ok, true);
  });

  it("--spend without confirm exits 2", async () => {
    resetChecklistMetrics();
    const prev = process.env.XCLAW_SOAK_CONFIRM;
    delete process.env.XCLAW_SOAK_CONFIRM;
    const r = await runConfirmChecklist({ spend: true, root });
    process.env.XCLAW_SOAK_CONFIRM = prev;
    assert.equal(r.ok, false);
    assert.equal(r.code, "CONFIRM_REQUIRED");
    assert.equal(r.exitCode, 2);
    assert.equal(getChecklistOk(), 0);
  });

  it("CLI dry-run exits 0", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(root, "scripts/horizon-confirm-checklist.mjs")],
      {
        encoding: "utf8",
        cwd: root,
        env: { ...process.env, XCLAW_SOAK_CONFIRM: "0" },
      }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, true);
  });

  it("CLI --spend without confirm exits 2", () => {
    const env = { ...process.env };
    delete env.XCLAW_SOAK_CONFIRM;
    const r = spawnSync(
      process.execPath,
      [path.join(root, "scripts/horizon-confirm-checklist.mjs"), "--spend"],
      { encoding: "utf8", cwd: root, env }
    );
    assert.equal(r.status, 2, r.stderr || r.stdout);
  });

  it("truncated checklist evidence is not a throw", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ck-"));
    const fp = checklistEvidencePath(base);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, '{"ok":tru');
    const r = await readChecklistResult({ base });
    assert.equal(r.ok, false);
    assert.equal(r.result, null);
    assert.equal(r.path, fp);
  });

  it("doctor exposes lastChecklist", async () => {
    const d = await doctorHorizon({});
    assert.ok("lastChecklist" in d || d.lastChecklist === null);
  });
});
