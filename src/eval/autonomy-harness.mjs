/**
 * Unified autonomy eval harness — offline by default.
 */
import { loadCases } from "./runner.mjs";
import { scoreCase } from "./scorer.mjs";
import { scoreAutonomyRun, aggregateAutonomy } from "./autonomy-metrics.mjs";
import { runAutonomyOfflineGate } from "./autonomy-offline-gate.mjs";

export async function runAutonomyHarness(opts = {}) {
  const offline = opts.offline !== false;
  const tag = opts.tag || "autonomy";
  const cases = await loadCases({ tag, id: opts.id });
  const results = [];

  if (offline) {
    for (const caseDef of cases) {
      const jobLike = opts.jobFactory
        ? await opts.jobFactory(caseDef)
        : {
            text: "",
            turns: 0,
            toolTrace: [],
            toolCalls: 0,
            toolErrors: 0,
            wallMs: 0,
            status: "pending",
            workspace: opts.workspace,
          };
      const scored = await scoreCase(caseDef, jobLike);
      const auto = scoreAutonomyRun(jobLike, scored);
      results.push({ id: caseDef.id, scored, auto });
    }
  }

  const aggregate = aggregateAutonomy(results.map((r) => r.auto).filter(Boolean));
  const gate = await runAutonomyOfflineGate({
    hardBlockRate: aggregate?.hardBlockRate ?? opts.hardBlockRate ?? 0,
    maxHardBlockRate: opts.maxHardBlockRate ?? 0.25,
  });

  return {
    ok: gate.ok,
    offline,
    caseCount: cases.length,
    results,
    aggregate,
    gate,
    at: new Date().toISOString(),
  };
}

export default { runAutonomyHarness };
