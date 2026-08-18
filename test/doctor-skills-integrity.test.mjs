import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pushSkillsIntegrity } from "../src/cli/doctor-skills-integrity.mjs";

describe("doctor skills integrity wire", () => {
  it("prod without lockfile pushes error", async () => {
    const checks = [];
    const push = (id, status, message) => checks.push({ id, status, message });
    const { doctorSkillsIntegrityCheck } = await import(
      "../src/skills/doctor-integrity.mjs"
    );
    const f = doctorSkillsIntegrityCheck({ profile: "prod" }, { hasLockfile: false });
    assert.equal(f.status, "error");
    push(f.id, f.status, f.message);
    assert.equal(checks[0].status, "error");
  });

  it("pushSkillsIntegrity is a function", () => {
    assert.equal(typeof pushSkillsIntegrity, "function");
  });
});
