#!/usr/bin/env node
/**
 * Evidence-backed release bundle (Phase K).
 * Writes eval/baselines/evidence-<version>.json and includes in package notes.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/load.mjs";
import { buildScoreboard } from "../src/eval/scoreboard.mjs";
import { getSoakSummary } from "../src/eval/soak.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const cfg = await loadConfig();
const scoreboard = await buildScoreboard(cfg, { root });
const soak = await getSoakSummary(cfg);

let mainBaseline = null;
try {
  mainBaseline = JSON.parse(
    await fs.readFile(path.join(root, "eval/baselines/main.json"), "utf8")
  );
} catch {
  /* */
}
let campaign = null;
try {
  campaign = JSON.parse(
    await fs.readFile(path.join(root, "eval/baselines/campaign.json"), "utf8")
  );
} catch {
  /* */
}

const requireSoak = process.env.REQUIRE_SOAK === "1" || process.env.XCLAW_RELEASE_STRICT === "1";
const evidence = {
  version: pkg.version,
  at: new Date().toISOString(),
  scoreboard,
  soak,
  baseline: {
    passRate: mainBaseline?.passRate,
    total: mainBaseline?.total,
    passed: mainBaseline?.passed,
  },
  campaign: {
    passRate: campaign?.passRate,
    total: campaign?.total,
    passed: campaign?.passed,
  },
  skillLoop: scoreboard.skillLoop || null,
  releaseOk:
    (scoreboard.releaseGate?.ok !== false) &&
    (soak.flakeBudgetOk !== false) &&
    (soak.gate?.passOk !== false) &&
    (!requireSoak || Boolean(soak.gate?.nightsOk)),
  requireSoak,
};

const out = path.join(root, "eval/baselines", `evidence-v${pkg.version}.json`);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify(evidence, null, 2) + "\n");
console.log(out);
console.log(JSON.stringify({ releaseOk: evidence.releaseOk, passRate: scoreboard.passRate, soakNights: soak.nights }, null, 2));
process.exit(evidence.releaseOk ? 0 : 1);
