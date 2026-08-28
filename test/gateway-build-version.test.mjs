/**
 * Every gateway version surface must report the build it is RUNNING.
 *
 * Six surfaces answered "what version is this?" by reading package.json off
 * disk at request time — `/version`, the Control UI dashboard, the Prometheus
 * `xclaw_info` gauge, the markdown status report, stop-health's surfaceVersion
 * fallback, and the gateway doctor report's stamp. On a box with a
 * self-deployer that is not the running build. Captured live:
 *
 *   /version      -> 3.303.0   (disk, read during the request)
 *   /gateway/info -> 3.302.0   (frozen at import = the running build)
 *   /health       -> 3.302.0
 *   uptimeSec 757 — the process had never restarted since the bump
 *
 * `/version` named a build that had never executed. `/metrics` was the worst
 * of the six: `xclaw_info{version="…"}` is what a scraper reads to confirm a
 * rollout landed, so a stale process could report itself as upgraded and pass
 * its own deploy check.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runningVersion,
  readOnDiskVersion,
  compareVersions,
  buildReport,
  summarizeBuildDrift,
} from "../src/gateway/build-version.mjs";
import { tryHandleOpsRoute } from "../src/gateway/routes/ops.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

describe("the running build is read once, not per request", () => {
  it("reports this process's version", () => {
    assert.equal(runningVersion(), PKG_VERSION);
  });

  it("is stable across calls even as the checkout moves", () => {
    // Cannot rewrite the real package.json here, but the contract is that the
    // value is frozen at module evaluation — so repeated calls never diverge
    // and never touch the filesystem again.
    const a = runningVersion();
    const b = runningVersion();
    assert.equal(a, b);
  });

  it("readOnDiskVersion is the separate, live read", () => {
    assert.equal(readOnDiskVersion(), PKG_VERSION);
  });
});

describe("/version reports the running build, not the checkout", () => {
  async function ask(XCLAW_VERSION) {
    let body = null;
    const handled = await tryHandleOpsRoute({
      p: "/version",
      method: "GET",
      req: { headers: {} },
      res: {},
      url: new URL("http://local/version"),
      cfg: { profile: "dev" },
      json: (_res, _code, payload) => { body = payload; },
      XCLAW_VERSION,
      XCLAW_PHASE: 7,
    });
    assert.equal(handled, true);
    return body;
  }

  it("does NOT return the on-disk version when the process is behind", async () => {
    // The exact live defect: the running build differs from package.json.
    const body = await ask("0.0.0-running");
    assert.equal(body.version, "0.0.0-running", "/version must name the running build");
    assert.notEqual(body.version, PKG_VERSION, "this is the disk read that shipped the lie");
  });

  it("publishes the drift instead of hiding it", async () => {
    const body = await ask("0.0.0-running");
    assert.equal(body.onDiskVersion, PKG_VERSION);
    assert.equal(body.stale, true);
    assert.equal(body.staleReason, "restart-pending");
  });

  it("is not stale when the process matches the checkout", async () => {
    const body = await ask(PKG_VERSION);
    assert.equal(body.version, PKG_VERSION);
    assert.equal(body.stale, false);
    assert.equal("staleReason" in body, false);
  });

  it("still carries uptime and profile", async () => {
    const body = await ask(PKG_VERSION);
    assert.equal(body.name, "xclaw");
    assert.equal(body.profile, "dev");
    assert.equal(typeof body.uptimeSec, "number");
    assert.equal(typeof body.startedAt, "string");
  });
});

describe("compareVersions", () => {
  it("orders numerically, not lexically", () => {
    // "3.303.0" < "3.99.0" as strings; the whole point is that it is not.
    assert.equal(compareVersions("3.99.0", "3.303.0"), -1);
    assert.equal(compareVersions("3.303.0", "3.99.0"), 1);
    assert.equal(compareVersions("3.303.0", "3.303.0"), 0);
    assert.equal(compareVersions("3.303.0", "3.304.0"), -1);
  });

  it("returns null rather than guessing on unparseable input", () => {
    assert.equal(compareVersions("3.303.0", "next"), null);
    assert.equal(compareVersions(null, "3.303.0"), null);
    assert.equal(compareVersions("3.303", "3.303.0"), null);
  });
});

describe("buildReport", () => {
  it("does not invent drift when package.json is unreadable", () => {
    // A failed read is not evidence of a stale process; reporting one would
    // page an operator over a permissions error.
    const r = buildReport("3.303.0", null);
    assert.equal(r.stale, false);
    assert.equal(r.onDiskVersion, null);
    assert.equal(r.version, "3.303.0");
  });

  it("labels an ahead-of-process checkout as restart-pending", () => {
    assert.equal(buildReport("3.303.0", "3.304.0").staleReason, "restart-pending");
  });

  it("labels a rolled-back checkout as checkout-behind", () => {
    assert.equal(buildReport("3.304.0", "3.303.0").staleReason, "checkout-behind");
  });

  it("treats an incomparable pair as drift, not as agreement", () => {
    const r = buildReport("3.303.0", "next");
    assert.equal(r.stale, true);
    assert.equal(r.staleReason, "checkout-behind");
  });
});

describe("doctor's gateway.build verdict", () => {
  it("is ok when the process is on the checkout's version", () => {
    const d = summarizeBuildDrift("3.303.0", "3.303.0");
    assert.equal(d.severity, "ok");
    assert.match(d.message, /running 3\.303\.0/);
  });

  it("warns — never errors — during the ordinary deploy window", () => {
    // Drift is the expected state between a deploy and its restart. An
    // operator mid-deploy must not be told the box is broken.
    const d = summarizeBuildDrift("3.303.0", "3.304.0");
    assert.equal(d.severity, "warn");
    assert.match(d.message, /has not picked up the deploy/);
    assert.match(d.message, /3\.304\.0/);
    assert.match(d.message, /restart/);
  });

  it("names the opposite direction differently", () => {
    const d = summarizeBuildDrift("3.304.0", "3.303.0");
    assert.equal(d.severity, "warn");
    assert.match(d.message, /ahead of its source/);
  });

  it("stays ok when the disk read failed", () => {
    assert.equal(summarizeBuildDrift("3.303.0", null).severity, "ok");
  });
});

describe("no gateway surface re-reads the version off disk", () => {
  // The defect shipped as four byte-identical pkgVersion() copies plus two
  // inline reads. Nothing about the runtime distinguishes a correct call from
  // a reintroduced copy — in-process, disk and running version are equal — so
  // the invariant is pinned against the source instead.
  const ALLOWED = new Set([
    // The one reader, by design.
    "build-version.mjs",
    // Reads package.json for the `xclaw.stopSurfaceFreeze` marker, which is a
    // disk fact; its version FALLBACK comes from build-version.
    "stop-health.mjs",
  ]);

  function walk(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(full));
      else if (e.name.endsWith(".mjs")) out.push(full);
    }
    return out;
  }

  it("only build-version.mjs reads package.json for a version", () => {
    const offenders = [];
    for (const file of walk(path.join(ROOT, "src", "gateway"))) {
      if (ALLOWED.has(path.basename(file))) continue;
      const src = fs.readFileSync(file, "utf8");
      // Strip comments so the explanatory notes left at each fixed site (which
      // all mention package.json) do not read as offences.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (/["'`]package\.json["'`]/.test(code)) offenders.push(path.relative(ROOT, file));
    }
    assert.deepEqual(
      offenders,
      [],
      `these re-read package.json at request time instead of importing runningVersion(): ${offenders.join(", ")}`
    );
  });

  it("the surfaces that report a version import the shared one", () => {
    for (const f of ["dashboard.mjs", "metrics.mjs", "report.mjs", "doctor.mjs"]) {
      const src = fs.readFileSync(path.join(ROOT, "src", "gateway", f), "utf8");
      assert.match(src, /from "\.\/build-version\.mjs"/, `${f} must use the shared running version`);
    }
  });
});
