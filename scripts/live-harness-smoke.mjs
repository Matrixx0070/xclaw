#!/usr/bin/env node
/**
 * Live long-harness smoke (requires API key in env).
 *
 *   export XAI_API_KEY=...          # or ANTHROPIC_API_KEY / OPENAI_API_KEY
 *   export XCLAW_PROFILE=lab
 *   node scripts/live-harness-smoke.mjs
 *
 * Optional:
 *   HARNESS_GOAL="..."
 *   HARNESS_WORKSPACE=/tmp/xclaw-live-harness
 */
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function hasProviderKey() {
  return Boolean(
    process.env.XAI_API_KEY ||
      process.env.XAI_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GROK_API_KEY
  );
}

async function main() {
  if (!hasProviderKey()) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          code: "NO_API_KEY",
          message:
            "Set XAI_API_KEY (or ANTHROPIC_API_KEY / OPENAI_API_KEY) in the environment. Do not paste keys into chat.",
        },
        null,
        2
      )
    );
    process.exit(2);
  }

  process.chdir(root);
  const { loadConfig } = await import("../src/config/load.mjs");
  const { ensureComputer } = await import("../src/computer/ensure.mjs");
  const { runLongHarness } = await import("../src/jobs/long-harness.mjs");

  const cfg = await loadConfig();
  // Lab for smoke unless user forced prod
  if (!process.env.XCLAW_PROFILE) {
    cfg.profile = cfg.profile || "lab";
  }

  console.error("[live-harness] ensuring computer…");
  const ready = await ensureComputer(cfg, { attempts: 3, log: true });
  if (!ready.ok) {
    console.error(
      JSON.stringify({ ok: false, code: "COMPUTER_DOWN", error: ready.error }, null, 2)
    );
    process.exit(3);
  }
  console.error("[live-harness] computer ok", ready.url);

  const workspace =
    process.env.HARNESS_WORKSPACE ||
    path.join(os.tmpdir(), "xclaw-live-harness");
  await fs.mkdir(workspace, { recursive: true });

  const marker = `LIVE_HARNESS_${Date.now().toString(36)}`;
  const rel = "notes/live_harness.txt";
  const goal =
    process.env.HARNESS_GOAL ||
    [
      `Create the directory notes if needed.`,
      `Write file ${rel} containing exactly one line: ${marker}`,
      `Re-read the file with a tool to confirm the contents.`,
      `Do not invent success — only claim what tools showed.`,
      `End with a structured claims JSON block citing tools used.`,
    ].join(" ");

  console.error("[live-harness] workspace", workspace);
  console.error("[live-harness] goal", goal.slice(0, 200) + "…");

  const job = await runLongHarness({
    goal,
    cfg,
    workspace,
    maxTurns: Number(process.env.HARNESS_MAX_TURNS || 12),
    timeoutMs: Number(process.env.HARNESS_TIMEOUT_MS || 180_000),
    verify: [
      { type: "file_exists", path: rel },
      { type: "file_contains", path: rel, text: marker },
    ],
    checkpointEveryTurns: 2,
    onEvent: (e) => {
      if (
        e.type === "harness" ||
        e.type === "job" ||
        (e.type === "tool" && e.phase === "end") ||
        (e.type === "guard" && e.level === "critical")
      ) {
        console.error("[event]", JSON.stringify(e));
      }
    },
  });

  const summary = {
    ok: job.pass === true,
    id: job.id,
    pass: job.pass,
    status: job.status,
    groundingFailed: job.groundingFailed,
    recoveryStrategy: job.recoveryStrategy,
    harness: job.harness,
    turns: job.turns,
    wallMs: job.wallMs,
    workspace: job.workspace,
    verify: job.verify,
    claimScore: job.claimScore,
    error: job.error,
    textPreview: String(job.text || "").slice(0, 500),
    marker,
    file: path.join(workspace, rel),
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(job.pass ? 0 : 1);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
  process.exit(1);
});
