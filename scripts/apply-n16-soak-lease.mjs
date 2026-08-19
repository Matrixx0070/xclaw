#!/usr/bin/env node
/** Idempotent: wire soak lease into horizon-live.mjs if missing. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fp = path.join(root, "src/eval/horizon-live.mjs");
let t = fs.readFileSync(fp, "utf8");
let n = 0;

if (!t.includes("acquireSoakLeaseSelected")) {
  const imp =
    'import {\n  incSoakResume,\n  renderSoakResumeMetrics,\n} from "./horizon-soak-resume-metrics.mjs";';
  const add =
    imp +
    '\nimport {\n  acquireSoakLeaseSelected,\n  releaseSoakLeaseSelected,\n} from "./horizon-soak-lease-select.mjs";\nimport {\n  incSoakLeaseDenied,\n  renderSoakLeaseMetrics,\n} from "./horizon-soak-lease-metrics.mjs";';
  if (t.includes(imp)) {
    t = t.replace(imp, add);
    n++;
  }
  const block =
    "  let lease = null;\n" +
    "  if (soakJobId) {\n" +
    '    checkpoint = await loadSoakCheckpoint(soakJobId, { base: opts.soakBase });\n' +
    "    if (checkpoint.turns > 0 || checkpoint.usedUsd > 0) {\n" +
    "      incSoakResume();\n" +
    "    }\n" +
    "    lease = await acquireSoakLeaseSelected(soakJobId, {\n" +
    "      base: opts.soakBase,\n" +
    "      owner: opts.leaseOwner,\n" +
    "      redis: opts.redis,\n" +
    "      backend: opts.leaseBackend,\n" +
    "      ttlMs: opts.leaseTtlMs,\n" +
    "    });\n" +
    "    if (!lease.ok) {\n" +
    "      incSoakLeaseDenied();\n" +
    "      return {\n" +
    '        ok: false,\n' +
    '        mode: "lease_denied",\n' +
    "        code: lease.code,\n" +
    "        lease,\n" +
    "        soakJobId,\n" +
    "        metricsLive: renderHorizonLiveMetrics(),\n" +
    "        metricsLease: renderSoakLeaseMetrics(),\n" +
    "      };\n" +
    "    }\n" +
    "  }";
  const old =
    "  if (soakJobId) {\n" +
    '    checkpoint = await loadSoakCheckpoint(soakJobId, { base: opts.soakBase });\n' +
    "    if (checkpoint.turns > 0 || checkpoint.usedUsd > 0) {\n" +
    "      incSoakResume();\n" +
    "    }\n" +
    "  }";
  if (t.includes(old) && !t.includes("lease_denied")) {
    t = t.replace(old, block);
    n++;
  }
  fs.writeFileSync(fp, t);
}

// CLI metricsLease
const cfp = path.join(root, "src/eval/horizon-cli.mjs");
let c = fs.readFileSync(cfp, "utf8");
if (!c.includes("metricsLease")) {
  if (!c.includes("horizon-soak-lease-metrics")) {
    c = c.replace(
      'import { renderSoakResumeMetrics } from "./horizon-soak-resume-metrics.mjs";',
      'import { renderSoakResumeMetrics } from "./horizon-soak-resume-metrics.mjs";\nimport { renderSoakLeaseMetrics } from "./horizon-soak-lease-metrics.mjs";\nimport { soakLeaseBackend } from "./horizon-soak-lease-select.mjs";'
    );
  }
  c = c.replace(
    "metricsResume: renderSoakResumeMetrics(),",
    "metricsResume: renderSoakResumeMetrics(),\n      metricsLease: renderSoakLeaseMetrics(),\n      leaseBackend: soakLeaseBackend({}),"
  );
  fs.writeFileSync(cfp, c);
  n++;
}

console.log(JSON.stringify({ ok: true, applied: n }));
