/**
 * CLI entry for `xclaw eval`
 */
import fs from "node:fs/promises";
import { loadConfig } from "../config/load.mjs";
import { runEvalSuite, formatEvalReport } from "./runner.mjs";

export async function evalMain(args = []) {
  const tag = argValue(args, "--tag");
  const id = argValue(args, "--id");
  const out = argValue(args, "--out");
  const jsonMode = args.includes("--json");
  const mock = args.includes("--mock");
  const baselinePath = argValue(args, "--baseline");
  const failOnRegress = args.includes("--fail-on-regress");

  const cfg = await loadConfig();
  // eval profile
  cfg.security = { ...(cfg.security || {}), autoApprove: true };
  cfg.agent = { ...(cfg.agent || {}), maxTurns: cfg.agent?.maxTurns || 8 };

  if (!mock) {
    const key =
      cfg.agent?.apiKey ||
      process.env.XCLAW_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.XAI_API_KEY;
    if (!key) {
      console.error(
        "[xclaw eval] No API key. Use --mock for harness-only, or set OPENAI_API_KEY / XCLAW_API_KEY"
      );
      process.exitCode = 2;
      return;
    }
  }

  const report = await runEvalSuite({ cfg, tag, id, mock });

  if (out) {
    await fs.writeFile(out, JSON.stringify(report, null, 2));
    console.error(`[xclaw eval] wrote ${out}`);
  }

  if (jsonMode) console.log(JSON.stringify(report, null, 2));
  else console.log(formatEvalReport(report));

  let exit = report.failed > 0 ? 1 : 0;

  if (baselinePath && failOnRegress) {
    try {
      const base = JSON.parse(await fs.readFile(baselinePath, "utf8"));
      if (report.passRate + 1e-9 < (base.passRate || 0) - 0.05) {
        console.error(
          `[xclaw eval] REGRESS passRate ${report.passRate.toFixed(3)} < baseline ${base.passRate}`
        );
        exit = 1;
      }
    } catch (err) {
      console.error(`[xclaw eval] baseline error: ${err.message}`);
    }
  }

  if (!mock && report.total) {
    console.error(
      `[xclaw eval] summary passRate=${(report.passRate * 100).toFixed(1)}% meanTurns=${report.meanTurns.toFixed(2)} meanWallMs=${report.meanWallMs.toFixed(0)}`
    );
  }

  process.exitCode = mock ? 0 : exit;
  return report;
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return null;
}
