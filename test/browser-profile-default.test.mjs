
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveProfileDir, DEFAULT_VAULT } from "../src/browser/profile.mjs";
import { horizon0Checklist } from "../src/browser/horizon0.mjs";

describe("browser profile default durable", () => {
  it("resolveProfileDir defaults to DEFAULT_VAULT", async () => {
    delete process.env.XCLAW_BROWSER_PROFILE_DIR;
    const r = await resolveProfileDir({});
    assert.equal(r.durable, true);
    assert.equal(r.userDataDir, path.resolve(DEFAULT_VAULT));
    await fs.access(path.join(r.userDataDir, "Default"));
  });

  it("ephemeral opt-out", async () => {
    const r = await resolveProfileDir({ ephemeral: true });
    assert.equal(r.durable, false);
    assert.ok(r.userDataDir.includes("xclaw-chrome-"));
  });

  it("horizon0 checklist not warn when default durable", () => {
    const env = { ...process.env };
    delete env.XCLAW_BROWSER_PROFILE_DIR;
    delete env.XCLAW_BROWSER_EPHEMERAL;
    const c = horizon0Checklist(env).find((x) => x.id === "profile");
    assert.equal(c.warn, false);
    assert.match(c.detail, /durable/);
  });

  it("horizon0 warns on ephemeral opt-out", () => {
    const c = horizon0Checklist({ XCLAW_BROWSER_EPHEMERAL: "1" }).find((x) => x.id === "profile");
    assert.equal(c.warn, true);
  });
});
