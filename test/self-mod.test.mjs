import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "path";
import os from "os";
import { fileURLToPath } from "node:url";
import {
  uncoveredGuardSurface,
  enforcementChainFiles,
  verifyFloorFiles,
  GUARD_MARKERS,
} from "../src/self/guard-surface.mjs";
import {
  detectSelfTarget,
  editSurfaceGuard,
  registerEditSurfaceHook,
  applySelfOverlay,
  selfVerifyCommands,
  SELF_DENY_PATHS,
} from "../src/self/profile.mjs";
import { createHookManager } from "../src/hooks/manager.mjs";
import {
  requestDeploy,
  readIntent,
  runDeployOnce,
  deployIntentPath,
} from "../src/self/deploy.mjs";

describe("A4 self profile", () => {
  let base;
  before(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-self-"));
  });
  after(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("detects the xclaw repo by package name and cfg.self.repoDir, incl. symlinks", async () => {
    const repo = path.join(base, "fake-xclaw");
    await fs.mkdir(repo, { recursive: true });
    await fs.writeFile(path.join(repo, "package.json"), JSON.stringify({ name: "xclaw" }));
    assert.equal(await detectSelfTarget({}, repo), true);

    const other = path.join(base, "other");
    await fs.mkdir(other, { recursive: true });
    await fs.writeFile(path.join(other, "package.json"), JSON.stringify({ name: "not-xclaw" }));
    assert.equal(await detectSelfTarget({}, other), false);

    const link = path.join(base, "link-to-xclaw");
    await fs.symlink(repo, link);
    assert.equal(await detectSelfTarget({ self: { repoDir: repo } }, link), true);
  });

  it("edit-surface guard denies writes/exec touching protected paths, allows the rest", () => {
    const guard = editSurfaceGuard(SELF_DENY_PATHS);
    const deny1 = guard({ toolName: "xclaw_file_write", args: { path: "src/security/approvals.mjs" } });
    assert.equal(deny1.decision, "deny");
    const deny2 = guard({ toolName: "xclaw_bash", args: { command: "sed -i s/x/y/ scripts/gateway-supervisor.mjs" } });
    assert.equal(deny2.decision, "deny");
    const allow = guard({ toolName: "xclaw_file_write", args: { path: "src/ops/ledger.mjs" } });
    assert.equal(allow.decision, undefined);
    const read = guard({ toolName: "xclaw_file_read", args: { path: "src/security/approvals.mjs" } });
    assert.equal(read.decision, undefined, "reads are allowed everywhere");
  });

  it("guard is segment-anchored: closes the unnormalized-substring bypass (review finding)", () => {
    const guard = editSurfaceGuard(SELF_DENY_PATHS, "/root/xclaw");
    // `.`-segment obfuscation that a raw includes() would MISS
    for (const p of [
      "src/./security/approvals.mjs",
      "src/security/../security/approvals.mjs",
      "/root/xclaw/src/security/approvals.mjs",
      "./bin/xclaw.mjs",
    ]) {
      assert.equal(
        guard({ toolName: "xclaw_file_write", args: { path: p } }).decision,
        "deny",
        `path bypass not closed: ${p}`
      );
    }
    // exec obfuscation
    assert.equal(
      guard({ toolName: "xclaw_bash", args: { command: "echo x > src/./self/deploy.mjs" } }).decision,
      "deny"
    );
    // false-positive guard: a similarly-named but DIFFERENT path is allowed
    assert.equal(
      guard({ toolName: "xclaw_file_write", args: { path: "src/security-docs/notes.md" } }).decision,
      undefined,
      "must not over-match sibling names"
    );
    assert.equal(
      guard({ toolName: "xclaw_file_write", args: { path: "mybin/tool.mjs" } }).decision,
      undefined
    );
  });

  it("guard registers as a system hook and denies through executeAll", async () => {
    const mgr = registerEditSurfaceHook(createHookManager({ cfg: {} }));
    const denied = await mgr.executeAll(
      "pre_tool_use",
      { toolName: "xclaw_file_write", args: { path: "bin/xclaw.mjs" }, cfg: {} },
      { matchKey: "xclaw_file_write" }
    );
    assert.equal(denied.decision, "deny");
  });

  it("overlay tightens security and carries deny paths; verify floor defaults to release-gate:quick", () => {
    const mcfg = applySelfOverlay({ security: { autoApprove: false } }, {});
    assert.equal(mcfg.security.autoApproveMaxTier, "risky");
    assert.equal(mcfg.security.riskContext.selfTarget, true);
    assert.ok(mcfg.self.denyPaths.includes("src/security/"));
    assert.deepEqual(selfVerifyCommands({}), ["npm run release-gate:quick"]);
  });
});

describe("A4 deploy protocol", () => {
  let dir;
  let cfg;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-deploy-"));
    cfg = {
      paths: { configDir: dir },
      gateway: { host: "127.0.0.1", port: 65510 }, // nothing listens — health fails
      self: {
        restartCmd: "true", // no-op restart for tests
        health: { retries: 1, delayMs: 50 },
        repoDir: dir,
      },
    };
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("requestDeploy writes a pending intent", async () => {
    const intent = await requestDeploy(cfg, {
      missionId: "msn_self1",
      repoDir: dir,
      mergeCommit: "abc123",
      prevKnownGood: "def456",
    });
    assert.equal(intent.state, "pending");
    const read = await readIntent(cfg);
    assert.equal(read.missionId, "msn_self1");
    assert.equal(deployIntentPath(cfg), path.join(dir, "self-deploy.json"));
  });

  it("failed health → rollback path resolves (git reset best-effort on non-repo)", async () => {
    // dir is not a git repo: reset fails, health fails again → state "failed"
    const out = await runDeployOnce(cfg);
    assert.ok(out);
    assert.ok(["rolled_back", "failed"].includes(out.state));
    assert.ok(out.healthChecks.length >= 1);
    const again = await runDeployOnce(cfg);
    assert.equal(again, null, "resolved intents are not re-consumed");
  });

  it("healthy path marks deployed", async () => {
    // spin a tiny /ready server
    const http = await import("node:http");
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ready: true }));
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port;
    const cfg2 = {
      ...cfg,
      gateway: { host: "127.0.0.1", port },
      self: { ...cfg.self, health: { retries: 2, delayMs: 20 } },
    };
    await requestDeploy(cfg2, { missionId: "msn_self2", repoDir: dir, mergeCommit: "abc999" });
    const out = await runDeployOnce(cfg2);
    srv.close();
    assert.equal(out.state, "healthy");
  });
});

describe("self edit-surface covers its own enforcement chain", () => {
  // Resolved from this file, not from cwd: the suite runs hermetically.
  const repoDir = fileURLToPath(new URL("..", import.meta.url));
  let fixture;

  before(async () => {
    // A miniature repo whose guard modules sit in places the real one does not
    // use, so the scan is graded on where it LOOKS, not on the real layout.
    fixture = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-surface-"));
    await fs.writeFile(
      path.join(fixture, "package.json"),
      JSON.stringify({ scripts: { floor: "npm run inner", inner: "node scripts/inner.mjs" } })
    );
    for (const [rel, body] of [
      ["bin/cli.mjs", "const x = DECISION_RANK;\n"],
      ["src/computer/xclaw-server.mjs", "const x = DECISION_RANK;\n"],
      ["src/plain.mjs", "export const nothing = 1;\n"],
    ]) {
      await fs.mkdir(path.join(fixture, path.dirname(rel)), { recursive: true });
      await fs.writeFile(path.join(fixture, rel), body);
    }
  });
  after(async () => {
    await fs.rm(fixture, { recursive: true, force: true });
  });

  it("denies every module the edit guard depends on", async () => {
    const { enforcement } = await uncoveredGuardSurface({ repoDir });
    assert.deepEqual(
      enforcement,
      [],
      `edit guard reachable from a self mission: ${enforcement.join(", ")}`
    );
  });

  it("denies the verify floor a self mission merges through", async () => {
    // On a host without cfg.self.requireMergeApproval, missions/engine.mjs
    // force-sets autoMerge — so a floor the mission can rewrite is a floor it
    // can pass by lowering.
    const { verify } = await uncoveredGuardSurface({ repoDir });
    assert.deepEqual(
      verify,
      [],
      `verify floor writable by a self mission: ${verify.join(", ")}`
    );
  });

  it("finds every module that decides or enforces the verdict", async () => {
    const files = await enforcementChainFiles(repoDir);
    // One per role, so dropping any single marker fails here rather than
    // shrinking the guarded set in silence.
    for (const rel of [
      "src/self/profile.mjs", // owns the list
      "src/hooks/manager.mjs", // ranks the verdict
      "src/agent/loop.mjs", // acts on a deny
      "src/missions/engine.mjs", // installs the guard
    ]) {
      assert.ok(files.includes(rel), `enforcement chain missed ${rel}`);
    }
  });

  it("scans both executable roots and skips the generated bundle", async () => {
    const files = await enforcementChainFiles(fixture);
    assert.ok(files.includes("bin/cli.mjs"), "bin/ is not being scanned");
    assert.ok(
      !files.includes("src/computer/xclaw-server.mjs"),
      "scanned the vendored build artifact"
    );
    assert.ok(!files.includes("src/plain.mjs"), "flagged a file with no marker");
  });

  it("carries no idle marker: each one still names something real", async () => {
    // A marker is a bet that some identifier denotes guard participation. Rename
    // the identifier and the bet silently stops paying — the scan narrows and
    // nothing says so. Graded against the repo's own files, never against a
    // fixture built from the marker itself, which would grade nothing.
    const files = (await enforcementChainFiles(repoDir)).filter(
      (f) => f !== "src/self/guard-surface.mjs" // where the markers are declared
    );
    const sources = await Promise.all(
      files.map((f) => fs.readFile(path.join(repoDir, f), "utf8"))
    );
    for (const marker of GUARD_MARKERS) {
      assert.ok(
        sources.some((src) => src.includes(marker)),
        `marker ${marker} matches no module — renamed away, and the scan narrowed silently`
      );
    }
  });

  it("follows npm-script indirection to the file the floor actually runs", async () => {
    const files = await verifyFloorFiles(fixture, { self: { verifyCommands: ["npm run floor"] } });
    assert.ok(files.includes("scripts/inner.mjs"), "stopped at the first script name");
    assert.ok(files.includes("package.json"), "the script map itself is part of the floor");
  });

  it("reports an omission rather than passing vacuously", async () => {
    for (const [hole, expected] of [
      ["src/hooks/manager.mjs", "enforcement"],
      ["scripts/", "verify"],
      ["package.json", "verify"],
    ]) {
      const holed = SELF_DENY_PATHS.filter((p) => p !== hole);
      const out = await uncoveredGuardSurface({ repoDir, denyPaths: holed });
      assert.ok(
        out[expected].length > 0,
        `removing ${hole} left ${expected} empty — the check grades nothing`
      );
    }
  });

  it("adds an operator's verifyCommands to the floor instead of replacing it", () => {
    const own = selfVerifyCommands({ self: { verifyCommands: ["npm run mine"] } });
    assert.ok(own.includes("npm run mine"), "dropped the operator's command");
    assert.ok(
      own.includes("npm run release-gate:quick"),
      "an operator's own verify list deleted the mandatory floor"
    );
  });

  it("keeps the floor for an empty list and for non-array values", () => {
    // [] is truthy in JS, so `||` handed it straight through and the mission
    // ran with no floor at all.
    assert.deepEqual(selfVerifyCommands({ self: { verifyCommands: [] } }), [
      "npm run release-gate:quick",
    ]);
    // A string spread into 7 single-character commands; an object threw into
    // engine.mjs's swallowing catch, leaving profile "self" set and the floor
    // never applied.
    assert.deepEqual(selfVerifyCommands({ self: { verifyCommands: "npm run x" } }), [
      "npm run release-gate:quick",
    ]);
    assert.deepEqual(selfVerifyCommands({ self: { verifyCommands: { a: 1 } } }), [
      "npm run release-gate:quick",
    ]);
  });

  it("adds an operator's denyPaths to the built-ins instead of replacing them", () => {
    const mcfg = applySelfOverlay({}, { self: { denyPaths: ["docs/"] } });
    assert.ok(mcfg.self.denyPaths.includes("docs/"), "dropped the operator's entry");
    assert.ok(
      mcfg.self.denyPaths.includes("src/security/"),
      "one added path disabled every built-in deny"
    );
  });
});
