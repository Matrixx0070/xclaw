/**
 * S3: orchestrators that own segmentation pass continuation:false so the
 * inner loop keeps a single-segment contract (totalTurnCap = maxTurns,
 * not maxTurns * 4). Cron announceCronJob already did. Automations
 * executeAutomation prefers runAgentOnce, which omitted the flag —
 * undefined meant ON, so a scheduled tick (and each goal-mode "single
 * most useful next step") silently quadrupled its turn budget.
 *
 * Persist stays in the automations store (goal ticks / results). This
 * pin does not invert default-path durability (sessionless HTTP still
 * does not mint agent-run snapshots).
 *
 * Running a live automation here would mean a real agent loop. Pin the
 * invariant at the source instead.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

function readRepo(rel) {
  return fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("automations ticks opt out of inner-loop continuation", () => {
  it("runAgentOnce passes continuation: false into runAgent", () => {
    const src = readRepo("../src/agent/run-once.mjs");
    const start = src.indexOf("const out = await runAgent(");
    assert.ok(start >= 0, "could not locate runAgent call in run-once");
    const end = src.indexOf("});", start);
    assert.ok(end > start, "could not locate end of runAgent call");
    const body = src.slice(start, end);
    assert.match(
      body,
      /continuation:\s*false/,
      "runAgentOnce must opt out of S3 auto-continue"
    );
    assert.ok(
      !/persistRun:\s*true/.test(body),
      "runAgentOnce must not mint agent-run snapshots; automations store owns results"
    );
  });

  it("executeAutomation still prefers runAgentOnce (the opted-out helper)", () => {
    const src = readRepo("../src/automations/index.mjs");
    // Dynamic import — injectable `runner` for tests, then run-once.mjs.
    assert.match(
      src,
      /import\(["']\.\.\/agent\/run-once\.mjs["']\)/,
      "executeAutomation must keep importing runAgentOnce"
    );
    assert.match(
      src,
      /await runAgentOnce\(/,
      "executeAutomation must still call runAgentOnce"
    );
  });

  it("cron announceCronJob still passes continuation: false", () => {
    const src = readRepo("../src/cron/announce.mjs");
    const start = src.indexOf("await runAgentLoop(");
    assert.ok(start >= 0, "could not locate runAgentLoop in announceCronJob");
    const end = src.indexOf("});", start);
    assert.ok(end > start, "could not locate end of runAgentLoop call");
    const body = src.slice(start, end);
    assert.match(
      body,
      /continuation:\s*false/,
      "announceCronJob must keep the S3 opt-out (automations fallback path)"
    );
  });
});
