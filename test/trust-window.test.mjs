import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApprovalGate, resetSharedApprovalGate } from "../src/security/approvals.mjs";
import { handleChannelCommand } from "../src/channels/commands.mjs";

const RISKY_CMD = "npm install left-pad"; // exec, not read-only → risky
const CRITICAL_CMD = "git push --force origin main";

function gateNoMaxTier() {
  return createApprovalGate({
    security: { autoApprove: false, approvalPolicy: "risky", requireApproval: ["xclaw_bash"], bindSystemRunPlan: false },
  });
}

describe("bounded trust window (approval-storm fix)", () => {
  it("risky pends without a window, auto-runs inside one, pends after clear", async () => {
    const gate = gateNoMaxTier();
    const before = await gate.authorize("xclaw_bash", { command: RISKY_CMD, cwd: "/tmp" }, { timeoutMs: 250 });
    assert.equal(before.ok, false, "risky must pend with no window");

    gate.setTrustWindow({ ttlMs: 30 * 60_000, by: "test" });
    const during = await gate.authorize("xclaw_bash", { command: RISKY_CMD, cwd: "/tmp" }, { timeoutMs: 250 });
    assert.equal(during.ok, true, "risky auto-runs inside the window");
    assert.equal(during.mode, "auto");

    gate.clearTrustWindow("test");
    const after = await gate.authorize("xclaw_bash", { command: RISKY_CMD, cwd: "/tmp" }, { timeoutMs: 250 });
    assert.equal(after.ok, false, "risky pends again after /trust off");
  });

  it("critical ALWAYS pends, even inside a trust window", async () => {
    const gate = gateNoMaxTier();
    gate.setTrustWindow({ ttlMs: 60 * 60_000, by: "test" });
    const crit = await gate.authorize("xclaw_bash", { command: CRITICAL_CMD, cwd: "/tmp" }, { timeoutMs: 250 });
    assert.equal(crit.ok, false, "critical must pend inside the window");
  });

  it("ceiling clamps to risky and ttl clamps to 1min..4h", () => {
    const gate = gateNoMaxTier();
    const t = gate.setTrustWindow({ maxTier: "critical", ttlMs: 10, by: "test" });
    assert.equal(t.maxTier, "risky", "hard ceiling");
    assert.ok(t.expiresAt >= Date.now() + 59_000, "min 1min");
    const t2 = gate.setTrustWindow({ ttlMs: 99 * 3600_000, by: "test" });
    assert.ok(t2.expiresAt <= Date.now() + 4 * 3600_000 + 1000, "max 4h");
    gate.clearTrustWindow("test");
  });

  it("expired window stops applying", (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const gate = gateNoMaxTier();
    gate.setTrustWindow({ ttlMs: 60_000, by: "test" });
    assert.ok(gate.activeTrustWindow(), "active immediately");
    t.mock.timers.tick(61_000);
    assert.equal(gate.activeTrustWindow(), null, "expired");
    t.mock.timers.reset();
  });

  it("/trust channel command sets, reports, and clears the window", async () => {
    const cfg = { security: { autoApprove: false, bindSystemRunPlan: false } };
    const gate = resetSharedApprovalGate(cfg);
    const set = await handleChannelCommand({ text: "/trust 30m", cfg, channel: "telegram", userId: "owner" });
    assert.equal(set.handled, true);
    assert.match(set.reply, /Trust window set: ≤risky/);
    assert.ok(gate.activeTrustWindow());

    const status = await handleChannelCommand({ text: "/trust", cfg, channel: "telegram" });
    assert.match(status.reply, /ACTIVE/);

    const off = await handleChannelCommand({ text: "/trust off", cfg, channel: "telegram" });
    assert.match(off.reply, /ended/);
    assert.equal(gate.activeTrustWindow(), null);

    const bad = await handleChannelCommand({ text: "/trust nonsense", cfg, channel: "telegram" });
    assert.match(bad.reply, /Usage/);
    resetSharedApprovalGate({});
  });
});
