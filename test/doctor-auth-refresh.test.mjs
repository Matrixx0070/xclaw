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
});
