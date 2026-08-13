import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { createBrowserTools } from "../src/tools/browser-tools.mjs";

// Regression: browser-tools.mjs shipped without imports for the physics /
// lease-heartbeat / sense / truth / timetravel / role-binding modules, so
// fabric_status, tab_lease, commit_gate (and friends) threw ReferenceError
// on every execute while the suite stayed green — nothing invoked them.

describe("browser-tools integrity", () => {
  let byName;

  before(async () => {
    // Isolate fabric state from the host's ~/.xclaw
    const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-bt-"));
    process.env.XCLAW_FABRIC_DIR = path.join(tmpHome, "fabric");
    const tools = createBrowserTools({
      computer: null,
      sessionId: "integrity-test",
      workingDir: process.cwd(),
    });
    byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  });

  it("registers the full tool set", () => {
    for (const name of [
      "fabric_status",
      "tab_lease",
      "commit_gate",
      "session_role",
      "trace_replay",
      "trace_score",
      "browser_assert",
      "mitm_policy",
    ]) {
      assert.ok(byName[name], `${name} registered`);
    }
  });

  it("fabric_status executes (was: fabricStatus is not defined)", async () => {
    const r = await byName.fabric_status.execute({});
    assert.equal(r.isError ?? false, false);
    assert.ok(r.metadata && typeof r.metadata.clock === "number");
  });

  it("tab_lease list executes (was: listTabLeases is not defined)", async () => {
    const r = await byName.tab_lease.execute({ action: "list" });
    assert.equal(r.isError ?? false, false);
    assert.ok(Array.isArray(r.metadata?.leases));
  });

  it("commit_gate list executes (was: listCommitGates is not defined)", async () => {
    const r = await byName.commit_gate.execute({ action: "list" });
    assert.equal(r.isError ?? false, false);
    assert.ok(Array.isArray(r.metadata?.gates));
  });

  it("session_role resolve executes (was: resolveRole is not defined)", async () => {
    const r = await byName.session_role.execute({ action: "resolve" });
    assert.equal(r.isError ?? false, false);
  });
});
