import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertPlanAtSpawn,
  buildEnforcedBashSpawn,
} from "../src/security/spawn-enforce.mjs";
import { buildSystemRunPlan } from "../src/security/system-run-plan.mjs";
import { executeBash } from "../src/computer/modules/bash-tool.mjs";

const cfgOff = { profile: "lab", security: { osSandbox: "off", spawnEnforce: "check" } };

describe("spawn enforce", () => {
  it("allows when no plan and not strict", () => {
    const r = assertPlanAtSpawn({
      plan: null,
      command: "echo hi",
      mode: "check",
    });
    assert.equal(r.ok, true);
    assert.equal(r.enforced, false);
  });

  it("denies command mutation vs frozen plan", () => {
    const built = buildSystemRunPlan({
      tool: "xclaw_bash",
      args: { command: "echo SAFE" },
      root: process.cwd(),
    });
    assert.equal(built.ok, true);
    const r = assertPlanAtSpawn({
      plan: built.plan,
      command: "echo PWNED",
      mode: "check",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "command_mismatch");
  });

  it("accepts exact frozen command", () => {
    const built = buildSystemRunPlan({
      tool: "xclaw_bash",
      args: { command: "echo SAFE" },
      root: process.cwd(),
    });
    const r = assertPlanAtSpawn({
      plan: built.plan,
      command: "echo SAFE",
      cwd: process.cwd(),
      mode: "check",
    });
    assert.equal(r.ok, true);
    assert.equal(r.enforced, true);
  });

  it("buildEnforcedBashSpawn uses -c not -lc", () => {
    const built = buildSystemRunPlan({
      tool: "xclaw_bash",
      args: { command: "echo x" },
      root: process.cwd(),
    });
    const spec = buildEnforcedBashSpawn({
      plan: built.plan,
      command: "echo x",
      cwd: process.cwd(),
    });
    assert.equal(spec.argv[0], "-c");
    assert.ok(!spec.argv.includes("-lc"));
    assert.equal(spec.argv[1], "echo x");
  });

  it("executeBash blocks mutated command when plan attached", async () => {
    const prev = process.env.XCLAW_OS_SANDBOX;
    process.env.XCLAW_OS_SANDBOX = "off";
    try {
      const built = buildSystemRunPlan({
        tool: "xclaw_bash",
        args: { command: "echo SAFE" },
        root: process.cwd(),
      });
      const r = await executeBash(
        { command: "echo PWNED", systemRunPlan: built.plan },
        { cwd: process.cwd(), cfg: cfgOff }
      );
      assert.equal(r.ok, false);
      assert.equal(r.blocked, true);
      assert.match(String(r.stderr), /spawn enforce|command/);
    } finally {
      if (prev == null) delete process.env.XCLAW_OS_SANDBOX;
      else process.env.XCLAW_OS_SANDBOX = prev;
    }
  });

  it("executeBash runs frozen command with enforcement", async () => {
    const prev = process.env.XCLAW_OS_SANDBOX;
    process.env.XCLAW_OS_SANDBOX = "off";
    try {
      const built = buildSystemRunPlan({
        tool: "xclaw_bash",
        args: { command: "echo SPAWN_OK" },
        root: process.cwd(),
      });
      const r = await executeBash(
        { command: "echo SPAWN_OK", systemRunPlan: built.plan },
        { cwd: process.cwd(), cfg: cfgOff }
      );
      assert.equal(r.ok, true, `stderr=${r.stderr} blocked=${r.blocked}`);
      assert.match(r.stdout, /SPAWN_OK/);
      assert.equal(r.spawnEnforced, true);
    } finally {
      if (prev == null) delete process.env.XCLAW_OS_SANDBOX;
      else process.env.XCLAW_OS_SANDBOX = prev;
    }
  });
});
