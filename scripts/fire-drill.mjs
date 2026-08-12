#!/usr/bin/env node
/**
 * Alert / SLO fire-drill (Phase Q).
 * Scenarios: computer_down, cost_hard, recover.
 * Uses dry alerter targets when none configured (records would-send).
 */
import { loadConfig } from "../src/config/load.mjs";
import { checkAndAlertSLOs } from "../src/ops/slo-monitor.mjs";
import { computeSLOs } from "../src/ops/slo.mjs";
import { recordJobCost, setCostGovernorPaused, getCostGovernorStatus } from "../src/tokens/cost-governor.mjs";
import { createAlerter } from "../src/alerting/alerts.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const cfg = await loadConfig();
const scenario = process.argv[2] || "all";
const report = { at: new Date().toISOString(), steps: [] };

function log(step, data) {
  report.steps.push({ step, ...data });
  console.error(`[fire-drill] ${step}`, JSON.stringify(data));
}

// Isolated config dir so we don't trash prod ledger
const drillDir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-drill-"));
const drillCfg = {
  ...cfg,
  paths: { ...(cfg.paths || {}), configDir: drillDir },
  cost: { dailySoftUsd: 0.01, dailyHardUsd: 0.02, pauseQueueOnHard: true },
  slo: {
    ...(cfg.slo || {}),
    computerUp: true,
    jobWallP99Ms: 1, // easy to breach if samples exist
    approvalPendingMax: 0,
  },
  computer: { host: "127.0.0.1", port: 1 }, // down
  alerting: {
    enabled: true,
    cooldownMs: 0,
    minSeverity: "info",
    targets: cfg.alerting?.targets?.length
      ? cfg.alerting.targets
      : [{ type: "log", channel: "log" }],
  },
};

if (scenario === "computer_down" || scenario === "all") {
  const slo = await computeSLOs(drillCfg);
  log("computer_down_slo", { ok: slo.ok, breaches: slo.breaches });
  const alert = await checkAndAlertSLOs(drillCfg);
  log("computer_down_alert", {
    breaches: alert.breaches,
    alerted: alert.alerted?.length,
  });
}

if (scenario === "cost_hard" || scenario === "all") {
  await recordJobCost(drillCfg, { usd: 1, jobId: "drill" });
  const cost = await getCostGovernorStatus(drillCfg);
  log("cost_hard", { ok: cost.ok, hard: cost.hard, paused: cost.paused });
}

if (scenario === "recover" || scenario === "all") {
  // recover computer: point at real port if any, else mark computerUp false target
  const upCfg = {
    ...drillCfg,
    computer: cfg.computer || { host: "127.0.0.1", port: 4243 },
    slo: { ...(drillCfg.slo || {}), computerUp: false },
  };
  // first establish breach state
  await checkAndAlertSLOs(drillCfg);
  const recovered = await checkAndAlertSLOs(upCfg);
  log("recover", {
    ok: recovered.ok,
    resolved: recovered.resolved?.length,
    breaches: recovered.breaches,
  });
}

// Direct alerter smoke
const alerter = createAlerter(drillCfg);
const sent = await alerter.send({
  key: "fire-drill:ping",
  severity: "error",
  title: "XClaw fire-drill ping",
  body: "Phase Q drill",
  source: "fire-drill",
});
log("alerter_ping", { sent });

console.log(JSON.stringify({ ok: true, drillDir, report }, null, 2));
process.exit(0);
