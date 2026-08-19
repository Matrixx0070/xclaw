#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pack = path.join(root, "scripts/apply-horizon-pack.mjs");
if (fs.existsSync(pack)) {
  spawnSync(process.execPath, [pack], { cwd: root, encoding: "utf8" });
}

const fp = path.join(root, "src/eval/horizon-live.mjs");
let t = fs.readFileSync(fp, "utf8");
if (!t.includes("beforeLiveTurn")) {
  t = t.replace(
    'from "./horizon-soak-resume-metrics.mjs";',
    'from "./horizon-soak-resume-metrics.mjs";\nimport { beforeLiveTurn, afterLiveTurn, renderLiveTurnMetrics, noteLastLiveRun } from "./horizon-live-turn.mjs";'
  );
  const old = `        const live = await runAgent({
          ...opts,
          maxTurns,
          maxUsd: policy.maxUsd,
          signal: controller.signal,
        });`;
  const neu = `        const preTurn = await beforeLiveTurn({
          usedUsd: policy.usedUsd,
          turns: policy.turns,
          highRisk: opts.highRisk,
        });
        if (!preTurn.ok) {
          noteLastLiveRun({ mode: "guard_blocked", soakJobId, code: preTurn.code });
          return {
            ok: false,
            mode: "guard_blocked",
            code: preTurn.code,
            guards: preTurn.guards,
            policy,
            soakJobId,
            metricsLiveTurn: renderLiveTurnMetrics(),
          };
        }
        const live = await runAgent({
          ...opts,
          maxTurns,
          maxUsd: policy.maxUsd,
          signal: controller.signal,
        });
        await afterLiveTurn({
          soakJobId,
          soakBase: opts.soakBase,
          turns: (policy.turns || 0) + 1,
          usedUsd: policy.usedUsd,
          workspace: opts.workspace,
          mode: "live",
        });`;
  if (t.includes(old)) t = t.replace(old, neu);
  fs.writeFileSync(fp, t);
}
console.log(JSON.stringify({ ok: true }));
