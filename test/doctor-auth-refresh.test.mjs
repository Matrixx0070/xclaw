import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  recordAuthRefreshStatus,
  loadAuthRefreshStatus,
  pushAuthRefreshChecks,
} from "../src/tokens/auth-refresh-status.mjs";

describe("doctor ops.auth_refresh", () => {
  it("records and loads status", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ar-"));
    const cfg = { paths: { configDir: dir } };
    await recordAuthRefreshStatus(cfg, {
      ok: true,
      results: [{ appId: "xai", ok: true, refreshed: false, source: "store" }],
    });
    const st = await loadAuthRefreshStatus(cfg);
    assert.equal(st.ok, true);
    assert.equal(st.results[0].appId, "xai");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("pushAuthRefreshChecks emits ops.auth_refresh", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ar2-"));
    const cfg = { paths: { configDir: dir } };
    await recordAuthRefreshStatus(cfg, {
      ok: true,
      results: [{ appId: "xai", ok: true, refreshed: true, source: "refresh" }],
    });
    const checks = [];
    const push = (id, status, message, extra) => checks.push({ id, status, message, extra });
    await pushAuthRefreshChecks(push, cfg);
    assert.equal(checks[0].id, "ops.auth_refresh");
    assert.equal(checks[0].status, "ok");
    assert.match(checks[0].message, /refreshed xai/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("warns when no status file", async () => {
    const checks = [];
    const push = (id, status, message) => checks.push({ id, status, message });
    await pushAuthRefreshChecks(push, {
      paths: { configDir: path.join(os.tmpdir(), "xclaw-ar-missing-" + Date.now()) },
    });
    assert.equal(checks[0].status, "warn");
  });

  // The writer (cost-preflight-auth) sets `soft` when a refresh failed but the
  // caller never required auth. A host running on API keys has no OAuth token,
  // so it records every app failed-and-soft on every single preflight; reading
  // that as a hard error means doctor reports a permanent false failure.
  const softStatus = {
    ok: true,
    soft: true,
    results: [
      { appId: "xai", ok: false, refreshed: false, error: "no token", code: "no_token" },
      { appId: "grok", ok: false, refreshed: false, error: "no token", code: "no_token" },
    ],
  };

  async function probe(status, cfgExtra = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-ar-soft-"));
    try {
      const cfg = { paths: { configDir: dir }, ...cfgExtra };
      await recordAuthRefreshStatus(cfg, status);
      const checks = [];
      await pushAuthRefreshChecks(
        (id, s, message, extra) => checks.push({ id, status: s, message, extra }),
        cfg
      );
      return checks[0];
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it("reports a soft refresh failure as a warning, not an error", async () => {
    const c = await probe(softStatus);
    assert.equal(c.id, "ops.auth_refresh");
    assert.equal(c.status, "warn");
    assert.equal(c.extra.soft, true);
    assert.deepEqual(c.extra.failed, ["xai", "grok"]);
  });

  it("names the apps and the reason so a warning is actionable", async () => {
    const c = await probe(softStatus);
    assert.match(c.message, /xai,grok/);
    assert.match(c.message, /no_token/);
    assert.match(c.message, /non-fatal/);
  });

  it("escalates the same soft failure in prod", async () => {
    const c = await probe(softStatus, { profile: "prod" });
    assert.equal(c.status, "error");
  });

  it("still errors on a hard failure, soft flag absent", async () => {
    const c = await probe({
      ok: false,
      soft: false,
      message: "auth refresh failed before cost preflight — re-login required",
      results: [{ appId: "xai", ok: false, refreshed: false, code: "revoked" }],
    });
    assert.equal(c.status, "error");
    assert.match(c.message, /re-login required/);
  });

  it("errors on a failure the writer never marked soft", async () => {
    const c = await probe({
      ok: true,
      soft: false,
      results: [{ appId: "xai", ok: false, refreshed: false, code: "revoked" }],
    });
    assert.equal(c.status, "error");
  });
});
