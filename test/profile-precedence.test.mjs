import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "path";
import os from "os";

describe("profile precedence", () => {
  let prevHome;
  let prevProfile;
  let dir;

  beforeEach(async () => {
    prevHome = process.env.HOME;
    prevProfile = process.env.XCLAW_PROFILE;
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-prof-"));
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
      JSON.stringify(obj, null, 2)
    );
  }

  it("env XCLAW_PROFILE wins over user.profile for pack selection", async () => {
    await writeUser({
      profile: "lab",
      security: {},
    });
    process.env.XCLAW_PROFILE = "prod";
    const { loadConfig } = await import("../src/config/load.mjs");
    const cfg = await loadConfig();
    assert.equal(cfg.profile, "prod");
    // prod pack applied; user did not set autoApprove so prod false wins
    assert.equal(cfg.security.autoApprove, false);
  });

  it("user autoApprove false still wins after env prod", async () => {
    await writeUser({
      profile: "lab",
      security: { autoApprove: true },
    });
    process.env.XCLAW_PROFILE = "prod";
    const { loadConfig } = await import("../src/config/load.mjs");
    const cfg = await loadConfig();
    assert.equal(cfg.profile, "prod");
    // 3.77.0 enforceProdHardening: prod forces autoApprove off even when the
    // user config says true — lab config cannot leak blanket auto-run into
    // prod. Break-glass is the explicit XCLAW_ALLOW_PROD_AUTO env.
    assert.equal(cfg.security.autoApprove, false);
  });

  it("XCLAW_ALLOW_PROD_AUTO break-glass restores user autoApprove in prod", async () => {
    await writeUser({
      profile: "lab",
      security: { autoApprove: true },
    });
    process.env.XCLAW_PROFILE = "prod";
    process.env.XCLAW_ALLOW_PROD_AUTO = "1";
    try {
      const { loadConfig } = await import("../src/config/load.mjs");
      const cfg = await loadConfig();
      assert.equal(cfg.profile, "prod");
      assert.equal(cfg.security.autoApprove, true);
    } finally {
      delete process.env.XCLAW_ALLOW_PROD_AUTO;
    }
  });

  it("default profile is lab when user omits profile", async () => {
    await writeUser({ agent: {} });
    const { loadConfig } = await import("../src/config/load.mjs");
    const cfg = await loadConfig();
    assert.equal(cfg.profile, "lab");
    assert.equal(cfg.security.autoApprove, true);
  });
});
