import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "path";
import os from "os";

// Regression for the 2026-08-13 live outage: an anthropic OAuth token sat
// expired for ~9 hours while doctor's providers.* checks stayed green,
// because "credential resolves" (checkProviderCredential) is not the same
// as "credential actually authenticates" — resolution succeeded even though
// the token was dead (a separate bug in the expiry check). Doctor now makes
// a real, forced (uncached) request to the active provider and surfaces an
// ERROR — not a warn — so hourly doctor-cron's notifyOnFail actually pages
// the operator instead of reporting green through an outage.

describe("doctor providers.liveCheck", () => {
  let prevHome;
  let dir;
  let origFetch;

  beforeEach(async () => {
    prevHome = process.env.HOME;
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-doc-live-"));
    process.env.HOME = dir;
    await fs.mkdir(path.join(dir, ".xclaw"), { recursive: true });
    origFetch = global.fetch;
  });

  afterEach(() => {
    process.env.HOME = prevHome;
    global.fetch = origFetch;
  });

  async function writeUser(obj) {
    await fs.writeFile(
      path.join(dir, ".xclaw", "xclaw.json"),
      JSON.stringify(
        {
          agent: { apiKey: "test-key", provider: "anthropic" },
          ...obj,
        },
        null,
        2
      )
    );
  }

  function find(report, id) {
    return report.checks.find((c) => c.id === id);
  }

  it("ERROR when the active provider's live call fails (the outage shape)", async () => {
    await writeUser({});
    global.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "OAuth access token has expired" }),
      text: async () => "",
    });
    const { runDoctor } = await import("../src/cli/doctor.mjs");
    const report = await runDoctor({ json: true });
    const c = find(report, "providers.liveCheck");
    assert.ok(c, "expected providers.liveCheck to run");
    assert.equal(c.status, "error");
    assert.equal(report.ok, false, "an outage must flip the whole report unhealthy");
  });

  it("OK when the active provider's live call succeeds", async () => {
    await writeUser({});
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "claude-sonnet-5" }] }),
      text: async () => "",
    });
    const { runDoctor } = await import("../src/cli/doctor.mjs");
    const report = await runDoctor({ json: true });
    const c = find(report, "providers.liveCheck");
    assert.ok(c);
    assert.equal(c.status, "ok");
  });

  it("skipped (hermetic) when doctor.providersLiveCheck is false", async () => {
    await writeUser({ doctor: { providersLiveCheck: false } });
    let called = false;
    global.fetch = async () => {
      called = true;
      throw new Error("should not be called");
    };
    const { runDoctor } = await import("../src/cli/doctor.mjs");
    const report = await runDoctor({ json: true });
    assert.equal(find(report, "providers.liveCheck"), undefined);
    assert.equal(called, false);
  });
});
