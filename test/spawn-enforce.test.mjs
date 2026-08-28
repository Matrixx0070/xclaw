import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertPlanAtSpawn,
  buildEnforcedBashSpawn,
  getSpawnEnforceMode,
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

describe("getSpawnEnforceMode — resolution table", () => {
  const withEnv = (vars, fn) => {
    const saved = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
  const clean = { XCLAW_SPAWN_ENFORCE: undefined, XCLAW_PROFILE: undefined };

  it("defaults to check with no config and no env", () => {
    withEnv(clean, () => {
      assert.equal(getSpawnEnforceMode({}), "check");
      assert.equal(getSpawnEnforceMode(), "check");
    });
  });

  it("defaults to check under the prod profile too (no hidden strict)", () => {
    // Pins the behaviour the deleted no-op branch claimed to change. Raising
    // prod to strict is a real behaviour change and must break this test.
    withEnv(clean, () => {
      assert.equal(getSpawnEnforceMode({ profile: "prod" }), "check");
    });
    withEnv({ ...clean, XCLAW_PROFILE: "prod" }, () => {
      assert.equal(getSpawnEnforceMode({}), "check");
    });
  });

  it("reads the operator config", () => {
    withEnv(clean, () => {
      assert.equal(getSpawnEnforceMode({ security: { spawnEnforce: "off" } }), "off");
      assert.equal(getSpawnEnforceMode({ security: { spawnEnforce: "STRICT" } }), "strict");
      assert.equal(getSpawnEnforceMode({ spawnEnforce: "off" }), "off");
    });
  });

  it("env overrides the config in both directions", () => {
    withEnv({ ...clean, XCLAW_SPAWN_ENFORCE: "off" }, () => {
      assert.equal(getSpawnEnforceMode({ security: { spawnEnforce: "strict" } }), "off");
    });
    withEnv({ ...clean, XCLAW_SPAWN_ENFORCE: "strict" }, () => {
      assert.equal(getSpawnEnforceMode({ security: { spawnEnforce: "off" } }), "strict");
    });
  });

  it("ignores an unrecognised config word and falls back to check", () => {
    withEnv(clean, () => {
      assert.equal(getSpawnEnforceMode({ security: { spawnEnforce: "enforce" } }), "check");
    });
  });
});
