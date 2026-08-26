import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "path";
import os from "os";
import {
  addDecision,
  matchDecision,
  loadDecisions,
  removeDecision,
} from "../src/security/decisions.mjs";
import { createApprovalGate } from "../src/security/approvals.mjs";

describe("durable decisions (A2)", () => {
  let dir;
  let cfg;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-dec-"));
    cfg = { security: { decisionsPath: path.join(dir, "decisions.json") } };
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("fingerprint pin matches exact plan, not others", async () => {
    const plan = { fingerprint: "fp_abc", exe: "/bin/bash", argv: ["echo"] };
    const { ok } = await addDecision(cfg, { tool: "xclaw_bash", plan, tier: "risky" });
    assert.ok(ok);
    const hit = await matchDecision(cfg, { tool: "xclaw_bash", plan, tier: "risky" });
    assert.ok(hit);
    const miss = await matchDecision(cfg, {
      tool: "xclaw_bash",
      plan: { fingerprint: "fp_other" },
      tier: "risky",
    });
    assert.equal(miss, null);
  });

  it("tier drift breaks the pin (risky pin cannot cover critical)", async () => {
    const plan = { fingerprint: "fp_drift", exe: "/bin/bash", argv: ["x"] };
    await addDecision(cfg, { tool: "xclaw_bash", plan, tier: "risky" });
    const hit = await matchDecision(cfg, { tool: "xclaw_bash", plan, tier: "critical" });
    assert.equal(hit, null);
  });

  it("wide pins expire and match by exe+argv0", async () => {
    // Two independent concerns, each pinned with a TTL chosen so its assertion
    // cannot race the async fs round-trip (mkdir+write+rename+read). A single
    // 50ms TTL shared by both flaked in CI: under the full parallel suite's
    // event-loop contention the "still live" read landed >50ms after the write,
    // pruneExpired() dropped the pin, and the alive assert saw undefined
    // (this file:54, run 32956726501). See the flake-repro-under-cpu-load rule.

    // (1) wide match while LIVE — a 60s TTL cannot lapse during the round-trip.
    const plan = { fingerprint: "fp_w", exe: "/usr/bin/git", argv: ["git"] };
    await addDecision(cfg, { tool: "xclaw_bash", plan, tier: "risky" }, { wide: true, ttlMs: 60_000 });
    const hit = await matchDecision(cfg, {
      tool: "xclaw_bash",
      plan: { fingerprint: "fp_DIFFERENT", exe: "/usr/bin/git", argv: ["git"] },
      tier: "risky",
    });
    assert.ok(hit, "wide pin matches different fingerprint with same exe");

    // (2) wide pin EXPIRES — expiry is monotonic, so a 1ms TTL is robustly gone
    // after any real delay (more contention only makes it MORE expired), unlike
    // a live-window assertion. A DISTINCT exe (/usr/bin/gitx) is required so the
    // still-live pin above cannot mask the expected null.
    const planX = { fingerprint: "fp_wx", exe: "/usr/bin/gitx", argv: ["gitx"] };
    await addDecision(cfg, { tool: "xclaw_bash", plan: planX, tier: "risky" }, { wide: true, ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 30));
    const expired = await matchDecision(cfg, {
      tool: "xclaw_bash",
      plan: { fingerprint: "fp_DIFFERENT2", exe: "/usr/bin/gitx", argv: ["gitx"] },
      tier: "risky",
    });
    assert.equal(expired, null, "expired wide pin must not match");
  });

  it("remove deletes; load survives missing file", async () => {
    const all = await loadDecisions(cfg);
    assert.ok(all.length >= 1);
    const r = await removeDecision(cfg, all[0].id);
    assert.ok(r.ok);
    const none = await loadDecisions({ security: { decisionsPath: path.join(dir, "nope.json") } });
    assert.deepEqual(none, []);
  });

  it("gate end-to-end: decide(allowAlways) pins; a NEW gate instance honors it", async () => {
    const dcfg = {
      security: {
        decisionsPath: path.join(dir, "e2e.json"),
        approvalPolicy: "risky",
        approvalSlaMs: 60_000,
      },
    };
    const gate1 = createApprovalGate(dcfg);
    let pendingId = null;
    const p1 = gate1.authorize(
      "xclaw_bash",
      { command: "echo pinned-proof", cwd: os.tmpdir() },
      { timeoutMs: 5000, onPending: (i) => (pendingId = i.id) }
    );
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(pendingId, "should pend");
    const d = gate1.decide(pendingId, true, "test", { allowAlways: true });
    assert.ok(d.ok);
    const r1 = await p1;
    assert.equal(r1.ok, true);
    assert.equal(r1.mode, "human");
    await new Promise((r) => setTimeout(r, 60)); // pin write is fire-and-forget

    // fresh gate = "restart": same command auto-approves via the pin
    const gate2 = createApprovalGate(dcfg);
    const r2 = await gate2.authorize(
      "xclaw_bash",
      { command: "echo pinned-proof", cwd: os.tmpdir() },
      { timeoutMs: 400 }
    );
    assert.equal(r2.ok, true, `expected pinned approve, got ${JSON.stringify(r2)}`);
    assert.equal(r2.mode, "pinned");

    // different command: not covered
    const r3 = await gate2.authorize(
      "xclaw_bash",
      { command: "echo other-command", cwd: os.tmpdir() },
      { timeoutMs: 300 }
    );
    assert.equal(r3.ok, false, "different plan must still pend");
  });
});
