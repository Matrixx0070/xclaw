import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "path";
import os from "os";

describe("doctor profile.mismatch", () => {
  let prevHome;
  let prevProfile;
  let dir;

  beforeEach(async () => {
    prevHome = process.env.HOME;
    prevProfile = process.env.XCLAW_PROFILE;
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-doc-mm-"));
    process.env.HOME = dir;
    delete process.env.XCLAW_PROFILE;
    await fs.mkdir(path.join(dir, ".xclaw"), { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = prevHome;
    if (prevProfile === undefined) delete process.env.XCLAW_PROFILE;
    else process.env.XCLAW_PROFILE = prevProfile;
  });

  async function writeUser(obj) {
    await fs.writeFile(
      path.join(dir, ".xclaw", "xclaw.json"),
      JSON.stringify(
        {
          agent: { apiKey: "test-key" },
          // Keep this test hermetic — providers.liveCheck makes a real
          // network call by design (that's the point of the feature).
          doctor: { providersLiveCheck: false },
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

  it("warns when profile=prod but autoApprove=true", async () => {
    await writeUser({
      profile: "prod",
      security: { autoApprove: true },
    });
    const { runDoctor } = await import("../src/cli/doctor.mjs");
    const report = await runDoctor({ json: true });
    const m = find(report, "profile.mismatch");
    assert.ok(m, JSON.stringify(report.checks.filter((c) => c.id.startsWith("profile")), null, 2));
    // Prod + autoApprove is elevated to error (honesty / safety).
    assert.ok(["warn", "error"].includes(m.status), m.status);
    assert.match(m.message, /prod/i);
    assert.match(m.message, /autoApprove/i);
  });

  it("warns when profile=lab but autoApprove=false", async () => {
    await writeUser({
      profile: "lab",
      security: { autoApprove: false },
    });
    const { runDoctor } = await import("../src/cli/doctor.mjs");
    const report = await runDoctor({ json: true });
    const m = find(report, "profile.mismatch");
    assert.ok(m, "expected profile.mismatch");
    assert.equal(m.status, "warn");
    assert.match(m.message, /lab/);
    assert.match(m.message, /autoApprove is false/);
  });

  it("ok when lab and autoApprove=true", async () => {
    await writeUser({
      profile: "lab",
      security: { autoApprove: true },
    });
    const { runDoctor } = await import("../src/cli/doctor.mjs");
    const report = await runDoctor({ json: true });
    assert.equal(find(report, "profile.mismatch"), undefined);
    const p = find(report, "profile");
    assert.ok(p);
    assert.equal(p.status, "ok");
    assert.match(p.message, /profile=lab/);
    assert.match(p.message, /autoApprove=true/);
  });

  it("ok when prod and autoApprove=false", async () => {
    await writeUser({
      profile: "prod",
      // omit security — prod pack sets autoApprove false
    });
    process.env.XCLAW_PROFILE = "prod";
    const { runDoctor } = await import("../src/cli/doctor.mjs");
    const report = await runDoctor({ json: true });
    assert.equal(find(report, "profile.mismatch"), undefined);
    const p = find(report, "profile");
    assert.ok(p);
    assert.equal(p.status, "ok");
    assert.match(p.message, /profile=prod/);
    assert.match(p.message, /autoApprove=false/);
  });
});
