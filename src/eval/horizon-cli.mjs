#!/usr/bin/env node
/**
 * xclaw eval horizon --offline [--all]
 * xclaw eval horizon --live (dry-run unless --confirm-live)
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { runHorizonSuiteOffline } from "./horizon-offline.mjs";
import { resetHorizonMetrics } from "./horizon-metrics.mjs";
import {
  incHorizonPackPass,
  renderHorizonPackMetrics,
  resetHorizonPackMetrics,
} from "./horizon-pack-metrics.mjs";
import { runHorizonLive, hasLiveKey } from "./horizon-live.mjs";
import { loadSoakPolicy } from "./horizon-soak-policy.mjs";
import { renderSoakMetrics } from "./horizon-soak-metrics.mjs";

export async function main(argv = process.argv.slice(2)) {
  const wantLive = argv.includes("--live");
  const confirmLive = argv.includes("--confirm-live");
  const includeAll =
    argv.includes("--all") || argv.includes("--offline-all");

  resetHorizonMetrics();
  resetHorizonPackMetrics();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-horizon-"));

  if (wantLive && !confirmLive) {
    const policy = loadSoakPolicy({});
    const dry = {
      ok: true,
      mode: "live_dry_run",
      hasKey: hasLiveKey({}),
      note: "Pass --confirm-live to spend against the provider",
      wouldRun: includeAll ? "G10-G20" : "default suite",
      policy,
      metricsPack: renderHorizonPackMetrics(),
      metricsSoak: renderSoakMetrics(),
    };
    console.log(JSON.stringify(dry, null, 2));
    process.exitCode = 0;
    return dry;
  }

  if (wantLive && confirmLive) {
    const policy = loadSoakPolicy({});
    const r = await runHorizonLive({
      workspace,
      includeAll,
      all: includeAll,
      requireLive: true,
      maxUsd: policy.maxUsd,
      maxTurns: policy.maxTurns,
    });
    r.policy = r.policy || policy;
    r.metricsSoak = r.metricsSoak || renderSoakMetrics();
    console.log(JSON.stringify(r, null, 2));
    process.exitCode = r.ok ? 0 : 1;
    return r;
  }

  const r = await runHorizonSuiteOffline({
    workspace,
    includeAll,
    all: includeAll,
    includeG12: includeAll || argv.includes("--g12"),
  });
  if (r.ok && includeAll) incHorizonPackPass();
  const out = {
    offline: true,
    includeAll,
    ...r,
    metricsPack: renderHorizonPackMetrics(),
  };
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = r.ok ? 0 : 1;
  return out;
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("horizon-cli.mjs")
) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export default { main };
