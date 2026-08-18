/**
 * Writes outside the workspace must not be treated as auto-safe.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { assessRisk, tierRank } from "../src/security/risk.mjs";
import {
  getSandboxPolicy,
  resolveSandboxPath,
} from "../src/security/sandbox.mjs";

describe("workspace write isolation", () => {
  const ws = path.join(os.tmpdir(), "xclaw-ws-iso");

  it("sandbox rejects path escape", () => {
    const policy = getSandboxPolicy({ sandbox: { enabled: true } }, ws);
    assert.throws(
      () => resolveSandboxPath(policy, "/etc/passwd"),
      /escapes workspace/
    );
    assert.throws(
      () => resolveSandboxPath(policy, "../../etc/shadow"),
      /escapes workspace/
    );
  });

  it("file write outside workspace is above auto-safe", () => {
    const r = assessRisk({
      tool: "xclaw_file_write",
      args: { path: "/tmp/xclaw-outside-ws.txt", content: "x" },
      workingDir: ws,
      cfg: {},
    });
    assert.ok(r.tier, JSON.stringify(r));
    assert.ok(
      r.scope === "home" || r.scope === "system" || r.scope !== "workspace",
      JSON.stringify(r)
    );
    assert.ok(
      tierRank(r.tier) >= tierRank("risky"),
      `expected >= risky, got ${r.tier} ${JSON.stringify(r)}`
    );
  });

  it("workspace-relative write stays lower risk", () => {
    const r = assessRisk({
      tool: "xclaw_file_write",
      args: { path: "notes.txt", content: "ok" },
      workingDir: ws,
      cfg: {},
    });
    assert.ok(r.scope === "workspace" || r.tier !== "critical", JSON.stringify(r));
  });
});
