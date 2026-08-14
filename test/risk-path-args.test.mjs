import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import { assessRisk, PATH_ARG_KEYS } from "../src/security/risk.mjs";
import { createApprovalGate } from "../src/security/approvals.mjs";

const WS = "/root/.xclaw/workspaces/tg-owner";

// Live BLOCKER regression (2026-08-14 13:09): xclaw_file_write passes
// `file_path`; risk.mjs extractPaths did not inspect it → scope defaulted
// "workspace" → an OUTSIDE-workspace write tiered "low" and auto-ran under
// autoApproveMaxTier:"low" with no approval and no policy record.
describe("risk path-arg keys (live blocker regression)", () => {
  it("file_path outside the run workspace tiers critical", () => {
    const r = assessRisk({
      tool: "xclaw_file_write",
      args: { file_path: "/root/sudo-ai-v4-audit-report.md", content: "x" },
      workingDir: WS,
    });
    assert.equal(r.tier, "critical", JSON.stringify(r.factors));
  });

  it("file_path inside the run workspace stays low", () => {
    const r = assessRisk({
      tool: "xclaw_file_write",
      args: { file_path: `${WS}/notes.md`, content: "x" },
      workingDir: WS,
    });
    assert.equal(r.tier, "low");
  });

  it("every self-profile key shape is inspected (single source)", () => {
    for (const k of ["file_path", "filePath", "fileName", "destination", "outputPath", "new_path"]) {
      assert.ok(PATH_ARG_KEYS.includes(k), k);
      const r = assessRisk({
        tool: "xclaw_file_write",
        args: { [k]: "/etc/target", content: "x" },
        workingDir: WS,
      });
      assert.equal(r.tier, "critical", `${k} must scope the write`);
    }
  });

  it("write tool with NO resolvable path fails closed (conservative scope)", () => {
    const r = assessRisk({
      tool: "mcp__x__create_or_update_file",
      args: { weirdKey: "/root/x", content: "x" },
      workingDir: WS,
    });
    assert.equal(r.factors.scope, "home");
    assert.ok(r.tier === "critical" || r.tier === "risky", r.tier);
    assert.ok(r.reasons.some((x) => /unresolved/.test(x)));
  });

  it("read tools keep the permissive default when pathless", () => {
    const r = assessRisk({ tool: "xclaw_file_list", args: {}, workingDir: WS });
    assert.equal(r.tier, "safe");
  });

  it("gate end-to-end: outside-workspace write PENDS under autoApproveMaxTier low", async () => {
    const gate = createApprovalGate({
      security: { autoApprove: false, autoApproveMaxTier: "low", bindSystemRunPlan: false },
    });
    const r = await gate.authorize(
      "xclaw_file_write",
      { file_path: "/root/elsewhere.md", content: "x" },
      { timeoutMs: 250, riskWorkingDir: WS }
    );
    assert.equal(r.ok, false, "must pend, not auto-run");
  });

  it("gate end-to-end: mission-worktree write still auto-runs (autonomy preserved)", async () => {
    const gate = createApprovalGate({
      security: { autoApprove: false, autoApproveMaxTier: "risky", bindSystemRunPlan: false },
    });
    const wt = "/tmp/xclaw-wt-fixture";
    const r = await gate.authorize(
      "xclaw_file_write",
      { file_path: `${wt}/src/fix.js`, content: "x" },
      { timeoutMs: 250, riskWorkingDir: wt }
    );
    assert.equal(r.ok, true, "worktree-scoped write is workspace/low");
    assert.equal(r.mode, "auto");
  });

  it("self profile imports the shared key list (no second copy)", async () => {
    const src = await fs.readFile(new URL("../src/self/profile.mjs", import.meta.url), "utf8");
    assert.match(src, /import \{ PATH_ARG_KEYS \} from "\.\.\/security\/risk\.mjs"/);
    assert.ok(!/const PATH_ARG_KEYS\s*=/.test(src), "local copy must be gone");
  });

  it("loop passes riskWorkingDir (wiring tripwire)", async () => {
    const src = await fs.readFile(new URL("../src/agent/loop.mjs", import.meta.url), "utf8");
    assert.match(src, /riskWorkingDir: workingDir/);
  });
});
