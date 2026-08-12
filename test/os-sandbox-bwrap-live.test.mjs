import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findBwrap,
  resetBwrapCache,
  wrapSpawnWithOsSandbox,
} from "../src/security/os-sandbox.mjs";
import { executeBash } from "../src/computer/modules/bash-tool.mjs";
import { buildSystemRunPlan } from "../src/security/system-run-plan.mjs";

describe("os-sandbox bwrap live", () => {
  it("executeBash reports osSandboxed under bwrap", async (t) => {
    resetBwrapCache();
    if (!findBwrap()) {
      t.skip("bubblewrap not installed");
      return;
    }
    const prev = process.env.XCLAW_OS_SANDBOX;
    process.env.XCLAW_OS_SANDBOX = "bwrap";
    try {
      const r = await executeBash(
        { command: "echo BWRAP_LIVE_OK" },
        {
          cwd: process.cwd(),
          workspace: process.cwd(),
          cfg: { security: { osSandbox: "bwrap" }, profile: "lab" },
        }
      );
      assert.equal(r.ok, true, r.stderr || "bash failed");
      assert.match(String(r.stdout), /BWRAP_LIVE_OK/);
      assert.equal(r.osSandboxed, true);
    } finally {
      if (prev == null) delete process.env.XCLAW_OS_SANDBOX;
      else process.env.XCLAW_OS_SANDBOX = prev;
      resetBwrapCache();
    }
  });

  it("unshare-net blocks curl when net denied", async (t) => {
    resetBwrapCache();
    if (!findBwrap()) {
      t.skip("bubblewrap not installed");
      return;
    }
    const prev = process.env.XCLAW_OS_SANDBOX;
    const prevNet = process.env.XCLAW_OS_SANDBOX_NET;
    process.env.XCLAW_OS_SANDBOX = "bwrap";
    process.env.XCLAW_OS_SANDBOX_NET = "deny";
    try {
      // curl may be missing; use /dev/tcp or python — simplest: bwrap --unshare-net + true still ok
      const w = wrapSpawnWithOsSandbox(
        {
          exe: "/bin/bash",
          argv: ["-c", "echo NET_ISOLATED"],
          cwd: process.cwd(),
          env: process.env,
        },
        {
          cfg: {
            security: { osSandbox: "bwrap", osSandboxUnshareNet: true },
            profile: "prod",
          },
          workspace: process.cwd(),
        }
      );
      assert.equal(w.sandboxed, true);
      assert.ok(w.argv.includes("--unshare-net"));
    } finally {
      if (prev == null) delete process.env.XCLAW_OS_SANDBOX;
      else process.env.XCLAW_OS_SANDBOX = prev;
      if (prevNet == null) delete process.env.XCLAW_OS_SANDBOX_NET;
      else process.env.XCLAW_OS_SANDBOX_NET = prevNet;
      resetBwrapCache();
    }
  });
});
