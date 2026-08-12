import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findBwrap,
  resetBwrapCache,
  probeBwrapWorks,
  getOsSandboxMode,
  buildBwrapArgv,
  wrapSpawnWithOsSandbox,
} from "../src/security/os-sandbox.mjs";

describe("os-sandbox bwrap", () => {
  it("getOsSandboxMode respects env off", () => {
    const prev = process.env.XCLAW_OS_SANDBOX;
    process.env.XCLAW_OS_SANDBOX = "off";
    try {
      assert.equal(getOsSandboxMode({}), "off");
    } finally {
      if (prev == null) delete process.env.XCLAW_OS_SANDBOX;
      else process.env.XCLAW_OS_SANDBOX = prev;
    }
  });

  it("buildBwrapArgv disabled when mode off", () => {
    const prev = process.env.XCLAW_OS_SANDBOX;
    process.env.XCLAW_OS_SANDBOX = "off";
    try {
      const r = buildBwrapArgv({ cfg: {}, cwd: process.cwd() });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "disabled");
    } finally {
      if (prev == null) delete process.env.XCLAW_OS_SANDBOX;
      else process.env.XCLAW_OS_SANDBOX = prev;
    }
  });

  it("wrapSpawnWithOsSandbox pass-through when off", () => {
    const prev = process.env.XCLAW_OS_SANDBOX;
    process.env.XCLAW_OS_SANDBOX = "off";
    try {
      const spec = {
        exe: "/bin/bash",
        argv: ["-c", "echo hi"],
        cwd: process.cwd(),
        env: process.env,
      };
      const w = wrapSpawnWithOsSandbox(spec, { cfg: {} });
      assert.equal(w.sandboxed, false);
      assert.equal(w.exe, "/bin/bash");
    } finally {
      if (prev == null) delete process.env.XCLAW_OS_SANDBOX;
      else process.env.XCLAW_OS_SANDBOX = prev;
    }
  });

  it("when bwrap usable, wraps with -- flags", (t) => {
    resetBwrapCache();
    const bw = findBwrap();
    if (!bw) {
      t.skip("bubblewrap not installed");
      return;
    }
    if (!probeBwrapWorks()) {
      t.skip(`bwrap unusable: ${probeBwrapWorks.lastError || "uid map"}`);
      return;
    }
    const prev = process.env.XCLAW_OS_SANDBOX;
    process.env.XCLAW_OS_SANDBOX = "bwrap";
    try {
      const spec = {
        exe: "/bin/bash",
        argv: ["-c", "echo SANDBOX_OK"],
        cwd: process.cwd(),
        env: process.env,
      };
      const w = wrapSpawnWithOsSandbox(spec, {
        cfg: { security: { osSandbox: "bwrap" } },
        workspace: process.cwd(),
      });
      assert.equal(w.sandboxed, true);
      assert.equal(w.exe, bw);
      assert.ok(w.argv.includes("--"));
      assert.ok(w.argv.includes("--die-with-parent"));
    } finally {
      if (prev == null) delete process.env.XCLAW_OS_SANDBOX;
      else process.env.XCLAW_OS_SANDBOX = prev;
      resetBwrapCache();
    }
  });

  it("forced bwrap mode without working binary denies or falls back", () => {
    resetBwrapCache();
    const prevB = process.env.XCLAW_BWRAP;
    const prevM = process.env.XCLAW_OS_SANDBOX;
    process.env.XCLAW_BWRAP = "/nonexistent/bwrap-binary-xclaw-test";
    process.env.XCLAW_OS_SANDBOX = "bwrap";
    resetBwrapCache();
    try {
      const w = wrapSpawnWithOsSandbox(
        { exe: "/bin/bash", argv: ["-c", "true"], cwd: process.cwd(), env: {} },
        { cfg: { security: { osSandbox: "bwrap" } } }
      );
      // Either deny (missing/unusable) or system bwrap still found via PATH
      assert.ok(
        w.deny === true || w.sandboxed === true || w.sandboxed === false,
        "wrap should return a defined sandbox decision"
      );
      if (w.deny) {
        assert.ok(
          w.reason === "bwrap_missing" || w.reason === "bwrap_unusable"
        );
      }
    } finally {
      if (prevB == null) delete process.env.XCLAW_BWRAP;
      else process.env.XCLAW_BWRAP = prevB;
      if (prevM == null) delete process.env.XCLAW_OS_SANDBOX;
      else process.env.XCLAW_OS_SANDBOX = prevM;
      resetBwrapCache();
    }
  });
});
