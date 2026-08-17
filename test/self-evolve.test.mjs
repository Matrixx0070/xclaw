import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  handsFreeConfigOverlay,
  handsFreeStatus,
  runEvolutionTick,
} from "../src/autonomy/self-evolve.mjs";

describe("self-evolution / hands-free", () => {
  it("overlay enables heartbeat and evolve resume", () => {
    const o = handsFreeConfigOverlay();
    assert.equal(o.autonomy.level, "full");
    assert.equal(o.autonomy.heartbeat.enabled, true);
    assert.equal(o.autonomy.evolve.autoResume, true);
    assert.equal(o.autonomy.evolve.autoPromote, false);
    assert.equal(o.harness.groundHard, true);
  });

  it("status returns structure", async () => {
    const st = await handsFreeStatus({
      profile: "lab",
      autonomy: { level: "lab" },
    });
    assert.ok(st.level);
    assert.ok(Array.isArray(st.blockers));
    assert.ok(st.evolve);
  });

  it("dry-run tick does not throw", async () => {
    const r = await runEvolutionTick(
      { profile: "lab", autonomy: { level: "lab", evolve: { autoResume: true } } },
      { dryRun: true }
    );
    assert.ok(r.status);
    assert.ok(Array.isArray(r.actions));
  });
});
