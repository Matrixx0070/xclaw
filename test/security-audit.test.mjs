
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runSecurityAudit } from "../src/security/audit.mjs";
import { buildApprovalDigest } from "../src/security/approval-digest.mjs";
import { createApprovalGate, resetSharedApprovalGate } from "../src/security/approvals.mjs";

/** The audit reads XCLAW_GATEWAY_TOKEN from the ambient env; pin it absent. */
function withoutGatewayToken(fn) {
  const prev = process.env.XCLAW_GATEWAY_TOKEN;
  delete process.env.XCLAW_GATEWAY_TOKEN;
  try {
    return fn();
  } finally {
    if (prev !== undefined) process.env.XCLAW_GATEWAY_TOKEN = prev;
  }
}

describe("security audit", () => {
  it("ok on localhost defaults", () => {
    const a = runSecurityAudit({
      gateway: { host: "127.0.0.1" },
      security: { autoApprove: false },
      sandbox: { enabled: true },
      agent: { apiKey: "x" },
    });
    assert.equal(a.errors, 0);
    assert.equal(a.ok, true);
    assert.ok(
      a.findings.some(
        (f) => f.id === "security.systemRunPlan" && f.level === "ok"
      )
    );
  });
  it("warns when bindSystemRunPlan explicitly off", () => {
    const a = runSecurityAudit({
      gateway: { host: "127.0.0.1" },
      security: { autoApprove: false, bindSystemRunPlan: false },
      agent: { apiKey: "x" },
    });
    assert.ok(
      a.findings.some(
        (f) => f.id === "security.systemRunPlan" && f.level === "warn"
      )
    );
  });
  it("errors on remote computer without token", () => {
    const a = runSecurityAudit({
      gateway: { host: "127.0.0.1" },
      computer: { remoteUrl: "http://10.0.0.2:4243" },
      agent: { apiKey: "x" },
    });
    assert.ok(a.findings.some((f) => f.id === "computer.remoteAuth" && f.level === "error"));
    assert.equal(a.ok, false);
  });
  it("warns public bind without token", () => {
    const a = runSecurityAudit({
      gateway: { host: "0.0.0.0" },
      agent: { apiKey: "x" },
    });
    assert.ok(a.findings.some((f) => f.id === "gateway.bind" && f.level === "warn"));
    assert.ok(a.findings.some((f) => f.id === "gateway.token"));
  });

  // The wildcard case above is the ONE bind the old two-branch check could
  // report. Every routable host fell into a silent third branch: no
  // gateway.bind finding at all, and ok stayed true.
  for (const host of ["10.0.0.5", "203.0.113.9", "192.168.1.20", "gw.example.com"]) {
    it(`warns on routable bind ${host}`, () => {
      const a = runSecurityAudit({
        gateway: { host, token: "t" },
        agent: { apiKey: "x" },
      });
      const f = a.findings.find((x) => x.id === "gateway.bind");
      assert.ok(f, `no gateway.bind finding for ${host}`);
      assert.equal(f.level, "warn");
      assert.ok(f.message.includes(host), f.message);
      assert.ok(f.fix, "a reachable bind must carry a remedy");
    });
  }

  it("grades ipv6 loopback ok, not silence", () => {
    const a = runSecurityAudit({
      gateway: { host: "::1", token: "t" },
      agent: { apiKey: "x" },
    });
    const f = a.findings.find((x) => x.id === "gateway.bind");
    assert.ok(f, "no gateway.bind finding for ::1");
    assert.equal(f.level, "ok");
  });

  it("grades a tokenless ipv6 loopback info, not error", () => {
    withoutGatewayToken(() => {
      const a = runSecurityAudit({ gateway: { host: "::1" }, agent: { apiKey: "x" } });
      const f = a.findings.find((x) => x.id === "gateway.token");
      assert.equal(f.level, "info");
    });
  });

  // The doctor's own owner.gatewayToken row calls this exact state an error
  // (prod && !token). The audit graded it on bind alone, so `security-audit`
  // told a prod operator with no token that everything was fine.
  it("errors on a prod profile without a gateway token, even on loopback", () => {
    withoutGatewayToken(() => {
      const a = runSecurityAudit({
        profile: "prod",
        gateway: { host: "127.0.0.1" },
        security: { autoApprove: false },
        agent: { apiKey: "x" },
      });
      const f = a.findings.find((x) => x.id === "gateway.token");
      assert.equal(f.level, "error");
      assert.equal(a.ok, false);
    });
  });

  it("honours XCLAW_PROFILE=prod the same way as cfg.profile", () => {
    withoutGatewayToken(() => {
      const prev = process.env.XCLAW_PROFILE;
      process.env.XCLAW_PROFILE = "prod";
      try {
        const a = runSecurityAudit({
          gateway: { host: "localhost" },
          security: { autoApprove: false },
          agent: { apiKey: "x" },
        });
        const f = a.findings.find((x) => x.id === "gateway.token");
        assert.equal(f.level, "error");
      } finally {
        if (prev === undefined) delete process.env.XCLAW_PROFILE;
        else process.env.XCLAW_PROFILE = prev;
      }
    });
  });

  it("names the wildcard case as all-interfaces and a routable one as reachable", () => {
    const w = runSecurityAudit({ gateway: { host: "0.0.0.0", token: "t" }, agent: { apiKey: "x" } });
    const r = runSecurityAudit({ gateway: { host: "10.0.0.5", token: "t" }, agent: { apiKey: "x" } });
    assert.match(w.findings.find((f) => f.id === "gateway.bind").message, /all interfaces/);
    assert.doesNotMatch(
      r.findings.find((f) => f.id === "gateway.bind").message,
      /all interfaces/,
      "a single-address bind is not a bind to all interfaces"
    );
  });

  it("errors on a tokenless non-loopback bind", () => {
    withoutGatewayToken(() => {
      for (const host of ["0.0.0.0", "10.0.0.5"]) {
        const a = runSecurityAudit({ gateway: { host }, agent: { apiKey: "x" } });
        const f = a.findings.find((x) => x.id === "gateway.token");
        assert.equal(f.level, "error", host);
        assert.equal(a.ok, false, host);
      }
    });
  });

  it("says prod in the prod tokenless message", () => {
    withoutGatewayToken(() => {
      const a = runSecurityAudit({
        profile: "prod",
        gateway: { host: "127.0.0.1" },
        security: { autoApprove: false },
        agent: { apiKey: "x" },
      });
      assert.match(a.findings.find((f) => f.id === "gateway.token").message, /prod/);
    });
  });

  it("still grades the prod profile's autoApprove", () => {
    const on = runSecurityAudit({
      profile: "prod",
      gateway: { host: "127.0.0.1", token: "t" },
      security: { autoApprove: true },
      agent: { apiKey: "x" },
    });
    assert.ok(on.findings.some((f) => f.id === "profile.prod" && f.level === "error"));
    const off = runSecurityAudit({
      profile: "prod",
      gateway: { host: "127.0.0.1", token: "t" },
      security: { autoApprove: false },
      agent: { apiKey: "x" },
    });
    assert.ok(off.findings.some((f) => f.id === "profile.prod" && f.level === "ok"));
  });

  it("keeps a tokenless lab localhost at info", () => {
    withoutGatewayToken(() => {
      const a = runSecurityAudit({ gateway: { host: "127.0.0.1" }, agent: { apiKey: "x" } });
      const f = a.findings.find((x) => x.id === "gateway.token");
      assert.equal(f.level, "info");
      assert.equal(a.ok, true);
    });
  });
});

describe("approval digest + plan fingerprint", () => {
  it("includes plan fingerprint in digest lines when present", async () => {
    const shared = resetSharedApprovalGate({
      security: {
        autoApprove: false,
        approvalPolicy: "risky",
        requireApproval: ["bash"],
        bindSystemRunPlan: true,
        approvalSlaMs: 60_000,
      },
    });
    // authorize awaits a filesystem quota preflight before it registers the
    // pending entry, so its latency is unbounded — a fixed sleep here failed
    // deterministically under CPU load (5/5 locally, and on CI's 22.x leg).
    // onPending fires immediately after the entry is registered: wait on that.
    let registered;
    const isPending = new Promise((r) => { registered = r; });
    const p = shared.authorize(
      "bash",
      { command: "echo digest-plan" },
      { timeoutMs: 5_000, onPending: () => registered() },
    );
    await isPending;
    const digest = buildApprovalDigest({
      security: { approvalSlaMs: 60_000 },
    });
    assert.ok(digest.pending >= 1);
    assert.ok(/plan=[0-9a-f]{12}/.test(digest.text), digest.text);
    const list = shared.listPending();
    if (list[0]) shared.decide(list[0].id, false, "cleanup");
    await p.catch(() => {});
  });
});

// security.bypassApprovals removes the approval gate outright: needsApproval
// returns false for every tier below critical, and for critical too when
// criticalOverride is "legacy". The audit graded the strictly WEAKER flag
// (autoApprove) and had no row for this one, so `xclaw security-audit` on a
// full-autonomy host printed "autoApprove off", ok:true, 0 errors, 0 warnings
// and exited 0 — the audit's clean bill of health was itself the misreport.
describe("security audit — bypassApprovals", () => {
  const base = { gateway: { host: "127.0.0.1", token: "t" }, agent: { apiKey: "k" } };
  const row = (cfg) =>
    runSecurityAudit(cfg).findings.find((f) => f.id === "security.bypassApprovals");

  it("reports the gate being removed, and never as clean", () => {
    const a = runSecurityAudit({ ...base, security: { autoApprove: false, bypassApprovals: true } });
    const f = a.findings.find((x) => x.id === "security.bypassApprovals");
    assert.ok(f, "no security.bypassApprovals row — the audit cannot see the gate being removed");
    assert.notEqual(f.level, "ok");
    assert.match(f.message, /bypassApprovals/);
    assert.ok(f.fix, "a row an operator cannot act on is half a report");
  });

  it("grades it an error on a hardened profile, like autoApprove", () => {
    const a = runSecurityAudit({
      ...base,
      profile: "prod",
      security: { autoApprove: false, bypassApprovals: true },
    });
    assert.equal(a.findings.find((x) => x.id === "security.bypassApprovals").level, "error");
    assert.equal(a.ok, false);
  });

  it("grades bypass + criticalOverride:legacy an error on any profile", () => {
    // The one state where NOTHING asks, at any tier — critical included.
    const a = runSecurityAudit({
      ...base,
      profile: "lab",
      security: { bypassApprovals: true, criticalOverride: "legacy" },
    });
    assert.equal(a.findings.find((x) => x.id === "security.bypassApprovals").level, "error");
    assert.equal(a.ok, false);
  });

  it("warns rather than errors on an unhardened profile", () => {
    const f = row({ ...base, profile: "lab", security: { bypassApprovals: true } });
    assert.equal(f.level, "warn");
  });

  it("states the posture when the gate is in place, so its absence is visible", () => {
    const f = row({ ...base, security: { autoApprove: false } });
    assert.ok(f, "no row at all when off — an operator cannot tell audited-off from unaudited");
    assert.equal(f.level, "ok");
  });

  it("only fires on the literal true, not on any truthy operator value", () => {
    for (const v of ["false", "no", 0, undefined, null]) {
      const f = row({ ...base, security: { bypassApprovals: v } });
      assert.equal(f.level, "ok", `bypassApprovals=${JSON.stringify(v)} is not the enabling value`);
    }
  });

  it("tracks the enforcer: what the audit grades is what the gate does", async () => {
    // Pins the audit's verdict to real behaviour rather than to a config read,
    // so the two cannot drift apart the way the audit and needsApproval had.
    const cfg = { ...base, security: { bypassApprovals: true, approvalSlaMs: 60_000 } };
    resetSharedApprovalGate();
    const gate = createApprovalGate(cfg);
    let pended = false;
    const decision = await gate.authorize(
      "bash",
      // Risky, deliberately NOT critical: bypass still pends critical unless
      // criticalOverride is "legacy", so a critical command would prove nothing.
      { command: "echo anchor > ./xclaw-bypass-anchor.txt" },
      { timeoutMs: 3_000, onPending: () => { pended = true; } }
    );
    assert.equal(pended, false, "risky call pended — bypass is not actually removing the gate");
    assert.ok(decision?.approved ?? decision === true, `expected approval, got ${JSON.stringify(decision)}`);
    // …and because it does, the audit must not call this host clean.
    assert.notEqual(row(cfg).level, "ok");
  });
});

/**
 * Pin every env var the graded predicates read, so a test grades the config in
 * front of it and not the developer's shell.
 */
function withEnv(vars, fn) {
  const keys = [
    "XCLAW_SPAWN_ENFORCE",
    "XCLAW_OS_SANDBOX_NET",
    "XCLAW_OS_SANDBOX",
    "XCLAW_EGRESS",
    "XCLAW_PROFILE",
  ];
  const prev = {};
  for (const k of keys) {
    prev[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(vars || {})) process.env[k] = v;
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

const AUDIT_BASE = {
  profile: "lab",
  gateway: { host: "127.0.0.1", token: "t" },
  agent: { apiKey: "k" },
};

function auditRow(cfg, id) {
  return runSecurityAudit(cfg).findings.find((f) => f.id === id);
}

describe("security audit — switches that DISABLE enforcement", () => {
  it("reports spawnEnforce=off, which unbinds the frozen plan at spawn", () => {
    withEnv({}, () => {
      const row = auditRow(
        { ...AUDIT_BASE, security: { spawnEnforce: "off" } },
        "security.spawnEnforce"
      );
      assert.ok(row, "no security.spawnEnforce row");
      assert.equal(row.level, "warn");
      assert.match(row.message, /off/);
    });
  });

  it("does NOT claim the plan is enforced while spawnEnforce is off", () => {
    withEnv({}, () => {
      const row = auditRow(
        {
          ...AUDIT_BASE,
          security: { bindSystemRunPlan: true, spawnEnforce: "off" },
        },
        "security.systemRunPlan"
      );
      assert.ok(row, "no security.systemRunPlan row");
      // The bug: this row printed level "ok" with "bindSystemRunPlan on
      // (frozen argv/cwd/exe before approval)" while assertPlanAtSpawn was
      // returning enforced:false for any command at all.
      assert.notEqual(row.level, "ok");
      assert.match(row.message, /not enforced at spawn|spawnEnforce/i);
    });
  });

  it("grades the ENFORCED spawn mode, so the env override is seen too", () => {
    withEnv({ XCLAW_SPAWN_ENFORCE: "off" }, () => {
      // Config says nothing; the env var is what the gate actually obeys.
      const row = auditRow({ ...AUDIT_BASE, security: {} }, "security.spawnEnforce");
      assert.ok(row, "env override produced no row");
      assert.equal(row.level, "warn");
    });
  });

  it("escalates spawnEnforce=off to error on a hardened profile", () => {
    withEnv({}, () => {
      const row = auditRow(
        { ...AUDIT_BASE, profile: "prod", security: { spawnEnforce: "off" } },
        "security.spawnEnforce"
      );
      assert.equal(row?.level, "error");
    });
  });

  it("emits an explicit ok row when spawn enforcement is on", () => {
    withEnv({}, () => {
      const row = auditRow({ ...AUDIT_BASE, security: {} }, "security.spawnEnforce");
      assert.equal(row?.level, "ok");
    });
  });

  it("reports mcpAutoApprove=true — every unvetted MCP tool auto-runs", () => {
    withEnv({}, () => {
      const row = auditRow(
        { ...AUDIT_BASE, security: { mcpAutoApprove: true } },
        "security.mcpAutoApprove"
      );
      assert.ok(row, "no security.mcpAutoApprove row");
      assert.equal(row.level, "warn");
      assert.match(row.message, /mcp/i);
    });
  });

  it("escalates mcpAutoApprove to error on a hardened profile", () => {
    withEnv({}, () => {
      const row = auditRow(
        { ...AUDIT_BASE, profile: "prod", security: { mcpAutoApprove: true } },
        "security.mcpAutoApprove"
      );
      assert.equal(row?.level, "error");
    });
  });

  it("emits an explicit ok row when mcpAutoApprove is off", () => {
    withEnv({}, () => {
      const row = auditRow({ ...AUDIT_BASE, security: {} }, "security.mcpAutoApprove");
      assert.equal(row?.level, "ok");
    });
  });

  it("reports osSandboxUnshareNet=false when egress makes the netns the boundary", () => {
    withEnv({}, () => {
      const row = auditRow(
        {
          ...AUDIT_BASE,
          security: { egress: { mode: "deny" }, osSandboxUnshareNet: false },
        },
        "security.osSandboxUnshareNet"
      );
      assert.ok(row, "no security.osSandboxUnshareNet row");
      assert.equal(row.level, "warn");
    });
  });

  it("escalates the netns downgrade to error on a hardened profile", () => {
    withEnv({}, () => {
      const row = auditRow(
        {
          ...AUDIT_BASE,
          profile: "prod",
          security: { egress: { mode: "allowlist" }, osSandboxUnshareNet: false },
        },
        "security.osSandboxUnshareNet"
      );
      assert.equal(row?.level, "error");
    });
  });

  it("stays silent about the netns when egress is open (nothing to downgrade)", () => {
    withEnv({}, () => {
      const row = auditRow(
        {
          ...AUDIT_BASE,
          security: { egress: { mode: "allow" }, osSandboxUnshareNet: false },
        },
        "security.osSandboxUnshareNet"
      );
      assert.equal(row, undefined, "reported a downgrade that cannot apply");
    });
  });

  it("emits an ok row when the netns boundary is intact under restricted egress", () => {
    withEnv({}, () => {
      const row = auditRow(
        { ...AUDIT_BASE, security: { egress: { mode: "deny" } } },
        "security.osSandboxUnshareNet"
      );
      assert.equal(row?.level, "ok");
    });
  });

  it("a full-autonomy host stops auditing clean", () => {
    withEnv({}, () => {
      const r = runSecurityAudit({
        ...AUDIT_BASE,
        profile: "prod",
        security: {
          spawnEnforce: "off",
          mcpAutoApprove: true,
          egress: { mode: "deny" },
          osSandboxUnshareNet: false,
        },
      });
      assert.equal(r.ok, false, "audit still reports ok on a fully-disarmed host");
      assert.ok(r.errors >= 3, `expected >=3 errors, got ${r.errors}`);
    });
  });
});
