import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findBwrap,
  resetBwrapCache,
  probeBwrapWorks,
  wrapSpawnWithOsSandbox,
} from "../src/security/os-sandbox.mjs";
import { executeBash } from "../src/computer/modules/bash-tool.mjs";

describe("os-sandbox bwrap live", () => {
  it("executeBash reports osSandboxed under bwrap", async (t) => {
    resetBwrapCache();
    if (!findBwrap()) {
      t.skip("bubblewrap not installed");
      return;
    }
    if (!probeBwrapWorks()) {
      t.skip(
        `bwrap unusable on this host: ${probeBwrapWorks.lastError || "uid map?"}`
      );
      return;
    }
    const prev = process.env.XCLAW_OS_SANDBOX;
    process.env.XCLAW_OS_SANDBOX = "bwrap";
    process.env.XCLAW_OS_SANDBOX_NET = "allow";
    try {
      const r = await executeBash(
        { command: "echo BWRAP_LIVE_OK" },
        {
          cwd: process.cwd(),
          workspace: process.cwd(),
          cfg: {
            security: { osSandbox: "bwrap", osSandboxUnshareNet: false },
            profile: "lab",
          },
        }
      );
      assert.equal(r.ok, true, `bash failed: ${r.stderr || ""}`);
      assert.match(String(r.stdout), /BWRAP_LIVE_OK/);
      assert.equal(r.osSandboxed, true);
    } finally {
      if (prev == null) delete process.env.XCLAW_OS_SANDBOX;
      else process.env.XCLAW_OS_SANDBOX = prev;
      delete process.env.XCLAW_OS_SANDBOX_NET;
      resetBwrapCache();
    }
  });

  it("argv includes unshare-net when explicitly requested", (t) => {
    resetBwrapCache();
    if (!findBwrap()) {
      t.skip("bubblewrap not installed");
      return;
    }
    // Only checks argv construction when probe works; if unusable, wrap falls back
    if (!probeBwrapWorks()) {
      t.skip("bwrap unusable — argv path not exercised");
      return;
    }
    const w = wrapSpawnWithOsSandbox(
      {
        exe: "/bin/bash",
        argv: ["-c", "echo x"],
        cwd: process.cwd(),
        env: process.env,
      },
      {
        cfg: { security: { osSandbox: "bwrap", osSandboxUnshareNet: true } },
        workspace: process.cwd(),
      }
    );
    assert.equal(w.sandboxed, true);
    assert.ok(w.argv.includes("--unshare-net"));
  });
});
