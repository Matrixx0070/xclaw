#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSourceIfChanged } from "./lib/atomic-source-write.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fp = path.join(root, "src/eval/horizon-cli.mjs");
let t = fs.readFileSync(fp, "utf8");
let n = 0;
if (!t.includes("writeLiveSoakReport")) {
  t = t.replace(
    'from "./horizon-soak-lease-select.mjs";',
    'from "./horizon-soak-lease-select.mjs";\nimport { writeLiveSoakReport, DEFAULT_LIVE_IDS } from "./horizon-live-report.mjs";'
  );
  const old = `    r.policy = r.policy || policy;
    r.metricsSoak = r.metricsSoak || renderSoakMetrics();
    console.log(JSON.stringify(r, null, 2));`;
  const neu = `    r.policy = r.policy || policy;
    r.metricsSoak = r.metricsSoak || renderSoakMetrics();
    const ids = includeAll ? undefined : DEFAULT_LIVE_IDS;
    const written = await writeLiveSoakReport({
      mode: r.mode || "live",
      ok: r.ok !== false,
      ids,
      usedUsd: r.policy?.usedUsd ?? 0,
      turns: r.policy?.turns ?? r.maxTurns ?? 0,
      soakJobId,
      canary: r.canary || { fail: 0 },
      scorecard: r.scorecard || { ok: null },
    });
    r.liveReportPath = written.path;
    r.liveReport = written.report;
    console.log(JSON.stringify(r, null, 2));`;
  if (t.includes(old)) {
    t = t.replace(old, neu);
    n++;
  }
  writeSourceIfChanged(fp, t);
}
const dfp = path.join(root, "src/cli/doctor-horizon.mjs");
let d = fs.readFileSync(dfp, "utf8");
if (!d.includes("readLiveSoakReport")) {
  d = d.replace(
    'from "../eval/horizon-scorecard-last.mjs";',
    'from "../eval/horizon-scorecard-last.mjs";\nimport { readLiveSoakReport, renderLiveReportMetrics } from "../eval/horizon-live-report.mjs";'
  );
  d = d.replace(
    "lastScorecardOk: lastCard.scorecard?.ok ?? null,",
    "lastScorecardOk: lastCard.scorecard?.ok ?? null,\n    lastLiveReport: await readLiveSoakReport({}),\n    metricsLiveReport: renderLiveReportMetrics(),"
  );
  writeSourceIfChanged(dfp, d);
  n++;
}
console.log(JSON.stringify({ ok: true, applied: n }));
