/**
 * P2 — Owner-gated skill install in prod
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  canInstallSkills,
  installProposal,
  proposeSkillFromFailure,
} from "../src/skills/propose.mjs";

describe("canInstallSkills", () => {
  it("allows lab by default", () => {
    assert.equal(canInstallSkills({ profile: "lab" }).ok, true);
  });

  it("blocks prod without approval", () => {
    const r = canInstallSkills({ profile: "prod" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "prod_requires_owner");
  });

  it("allows prod with config", () => {
    assert.equal(
      canInstallSkills({ profile: "prod", skills: { allowInstall: true } }).ok,
      true
    );
  });

  it("allows prod with ownerApproved", () => {
    assert.equal(
      canInstallSkills({ profile: "prod" }, { ownerApproved: true }).ok,
      true
    );
  });
});

describe("installProposal prod gate", () => {
  it("refuses install on prod", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-sk-"));
    const cfg = {
      profile: "prod",
      paths: { configDir: dir, skillsDir: path.join(dir, "skills") },
    };
    const prop = await proposeSkillFromFailure(cfg, {
      caseId: "t1",
      goal: "demo",
      failures: ["x"],
    });
    const r = await installProposal(cfg, prop.path, { force: true });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "prod_requires_owner");
  });

  it("installs on prod when ownerApproved", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-sk2-"));
    const cfg = {
      profile: "prod",
      paths: { configDir: dir, skillsDir: path.join(dir, "skills") },
    };
    const prop = await proposeSkillFromFailure(cfg, {
      caseId: "t2",
      goal: "demo",
      failures: ["x"],
    });
    const r = await installProposal(cfg, prop.path, {
      force: true,
      ownerApproved: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.installed, true);
    await fs.access(r.path);
  });
});
