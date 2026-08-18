/**
 * Prod skill lock: missing skills.lock.json is a doctor error.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveIntegrityMode,
  LOCKFILE_NAME,
} from "../src/skills/integrity.mjs";
import { doctorSkillsIntegrityCheck } from "../src/skills/doctor-integrity.mjs";

describe("skills integrity prod posture", () => {
  it("prod without lockfile → doctor error", () => {
    const r = doctorSkillsIntegrityCheck({ profile: "prod" }, { hasLockfile: false });
    assert.equal(r.status, "error");
    assert.match(r.message, new RegExp(LOCKFILE_NAME));
    assert.match(r.message, /skills lock/i);
  });

  it("lab without lockfile → ok", () => {
    const r = doctorSkillsIntegrityCheck({ profile: "lab" }, { hasLockfile: false });
    assert.equal(r.status, "ok");
  });

  it("prod with lockfile and no drift → ok", () => {
    const r = doctorSkillsIntegrityCheck(
      { profile: "prod" },
      { hasLockfile: true, driftCount: 0, mode: "enforce" }
    );
    assert.equal(r.status, "ok");
  });

  it("lockfile with drift → warn", () => {
    const r = doctorSkillsIntegrityCheck(
      { profile: "prod" },
      { hasLockfile: true, driftCount: 2, mode: "enforce" }
    );
    assert.equal(r.status, "warn");
    assert.match(r.message, /2 skill/);
  });

  it("resolveIntegrityMode: prod + lockfile = enforce", () => {
    assert.equal(resolveIntegrityMode({ profile: "prod" }, true), "enforce");
    assert.equal(resolveIntegrityMode({ profile: "prod" }, false), "off");
  });
});
