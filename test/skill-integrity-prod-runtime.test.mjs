/**
 * Prod agent path: no skills.lock.json → enforce excludes all skills.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resolveIntegrityMode,
  applyIntegrity,
  _resetWarnedForTests,
} from "../src/skills/integrity.mjs";

describe("skill integrity prod runtime enforce", () => {
  beforeEach(() => {
    _resetWarnedForTests();
  });

  it("prod without lockfile → mode enforce", () => {
    assert.equal(resolveIntegrityMode({ profile: "prod" }, false), "enforce");
  });

  it("lab without lockfile → mode off", () => {
    assert.equal(resolveIntegrityMode({ profile: "lab" }, false), "off");
  });

  it("explicit off wins over prod", () => {
    assert.equal(
      resolveIntegrityMode({ profile: "prod", skills: { integrity: "off" } }, false),
      "off"
    );
  });

  it("applyIntegrity prod no lockfile returns empty skills", async () => {
    const fake = [
      { name: "alpha", path: "/tmp/nope/SKILL.md" },
      { name: "beta", path: "/tmp/nope2/SKILL.md" },
    ];
    const res = await applyIntegrity(fake, {
      cwd: "/tmp",
      cfg: { profile: "prod" },
    });
    assert.equal(res.mode, "enforce");
    assert.equal(res.skills.length, 0);
    assert.equal(res.report?.reason, "no_lockfile");
    assert.ok(res.report.excluded.includes("alpha"));
  });

  it("applyIntegrity lab no lockfile keeps skills", async () => {
    const fake = [{ name: "alpha", path: "/tmp/nope/SKILL.md" }];
    const res = await applyIntegrity(fake, {
      cwd: "/tmp",
      cfg: { profile: "lab" },
    });
    assert.equal(res.mode, "off");
    assert.equal(res.skills.length, 1);
  });
});
