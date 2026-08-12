import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildSystemRunPlan,
  planFingerprint,
  revalidatePlan,
  extractArgv,
  isExecTool,
  PLAN_VERSION,
} from "../src/security/system-run-plan.mjs";

describe("system-run-plan", () => {
  it("extractArgv handles command string and argv array", () => {
    assert.deepEqual(extractArgv({ command: "echo hello world" }), [
      "echo",
      "hello",
      "world",
    ]);
    assert.deepEqual(extractArgv({ argv: ["ls", "-la"] }), ["ls", "-la"]);
    assert.deepEqual(extractArgv({}), []);
  });

  it("isExecTool recognizes bash family", () => {
    assert.equal(isExecTool("xclaw_bash"), true);
    assert.equal(isExecTool("BASH"), true);
    assert.equal(isExecTool("xclaw_file_read"), false);
  });

  it("builds a frozen plan for bash with fingerprint", () => {
    const { ok, plan } = buildSystemRunPlan({
      tool: "xclaw_bash",
      args: { command: "echo test", cwd: process.cwd() },
      root: process.cwd(),
    });
    assert.equal(ok, true);
    assert.equal(plan.version, PLAN_VERSION);
    assert.equal(plan.tool, "xclaw_bash");
    assert.equal(plan.isExec, true);
    assert.ok(Array.isArray(plan.argv));
    assert.equal(plan.argv[0], "echo");
    assert.ok(plan.fingerprint);
    assert.equal(plan.fingerprint.length, 32);
    assert.equal(planFingerprint(plan), plan.fingerprint);
  });

  it("fail-closed when requirePinnedExe and binary unresolvable", () => {
    const { ok, reason } = buildSystemRunPlan({
      tool: "xclaw_bash",
      args: {
        command: "/nonexistent/binary/xyz_no_such_thing_12345",
        requirePinnedExe: true,
      },
      root: process.cwd(),
    });
    assert.equal(ok, false);
    assert.equal(reason, "exe_unboundable");
  });

  it("revalidatePlan passes for stable plan", () => {
    const { plan } = buildSystemRunPlan({
      tool: "xclaw_file_read",
      args: { path: "." },
      root: process.cwd(),
    });
    const r = revalidatePlan(plan);
    assert.equal(r.ok, true);
  });

  it("revalidatePlan detects missing plan", () => {
    const r = revalidatePlan(null);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_plan");
  });

  it("hashes file operands when requested", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-plan-"));
    const file = path.join(tmp, "payload.txt");
    fs.writeFileSync(file, "hello-plan");
    try {
      const { ok, plan } = buildSystemRunPlan({
        tool: "xclaw_file_read",
        args: { path: file },
        root: tmp,
        hashFileOperands: true,
      });
      assert.equal(ok, true);
      assert.equal(plan.fileOperands.length, 1);
      assert.ok(plan.fileOperands[0].hash);
      assert.equal(plan.fileOperands[0].hash.length, 64);

      // mutate → revalidate should fail
      fs.writeFileSync(file, "mutated");
      const r = revalidatePlan(plan);
      assert.equal(r.ok, false);
      assert.equal(r.reason, "plan_drift");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
