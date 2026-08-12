
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  mapSwarmRoleToFabric,
  bindSwarmSpawnRole,
  resolveRole,
  getBoundRole,
} from "../src/browser/role-binding.mjs";

describe("C2 swarm spawn role binding", () => {
  let tmp;
  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-c2-"));
    process.env.XCLAW_FABRIC_DIR = tmp;
    process.env.XCLAW_FABRIC_ENFORCE = "1";
    delete process.env.XCLAW_ROLE_FROM_ENV;
    delete process.env.XCLAW_AGENT_ROLE;
  });
  after(async () => {
    delete process.env.XCLAW_FABRIC_DIR;
    delete process.env.XCLAW_FABRIC_ENFORCE;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("maps swarm roles to fabric roles", () => {
    assert.equal(mapSwarmRoleToFabric("implement"), "actor");
    assert.equal(mapSwarmRoleToFabric("research"), "observer");
    assert.equal(mapSwarmRoleToFabric("critic"), "critic");
    assert.equal(mapSwarmRoleToFabric("verify"), "observer");
    assert.equal(mapSwarmRoleToFabric("actor"), "actor");
  });

  it("bindSwarmSpawnRole is trusted session_bind", async () => {
    const r = await bindSwarmSpawnRole({
      spawnId: "spawn-1",
      sessionId: "sess-1",
      swarmRole: "critic",
    });
    assert.equal(r.ok, true);
    assert.equal(r.fabricRole, "critic");
    const g = await getBoundRole("sess-1");
    assert.equal(g.role, "critic");
    const resolved = await resolveRole({ sessionId: "sess-1" });
    assert.equal(resolved.role, "critic");
    assert.equal(resolved.source, "session_bind");
    assert.equal(resolved.trusted, true);
  });

  it("implement maps to actor and wins under strict", async () => {
    await bindSwarmSpawnRole({
      spawnId: "spawn-impl",
      sessionId: "sess-impl",
      swarmRole: "implement",
    });
    const resolved = await resolveRole({ sessionId: "sess-impl" });
    assert.equal(resolved.role, "actor");
  });

  it("env cannot override swarm bind under strict", async () => {
    await bindSwarmSpawnRole({
      spawnId: "spawn-c",
      sessionId: "sess-c",
      swarmRole: "critic",
    });
    process.env.XCLAW_AGENT_ROLE = "actor";
    const resolved = await resolveRole({ sessionId: "sess-c" });
    assert.equal(resolved.role, "critic");
    delete process.env.XCLAW_AGENT_ROLE;
  });
});
