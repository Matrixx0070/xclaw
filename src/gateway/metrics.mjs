/**
 * Prometheus text exposition (subset) for ops scrapers.
 */
import { queueStats } from "../jobs/queue.mjs";
import { summarizeEvalSpend } from "../eval/spend.mjs";
import { isComputerRunning } from "../computer/manager.mjs";
// xclaw_info{version=...} is the gauge a scraper uses to confirm a rollout
// reached a host. Read off disk per scrape, it let a process that had never
// restarted report itself as upgraded — so it must be the RUNNING build.
import { runningVersion as pkgVersion } from "./build-version.mjs";

/**
 * @param {object} cfg
 * @returns {Promise<string>}
 */
export async function renderMetrics(cfg) {
  const lines = [];
  const v = pkgVersion();
  lines.push("# HELP xclaw_info XClaw version info");
  lines.push("# TYPE xclaw_info gauge");
  lines.push(`xclaw_info{version="${v}",profile="${cfg.profile || "dev"}"} 1`);
  const { uptimeSec } = await import("./uptime.mjs").then((m) => m.uptimeInfo());
  lines.push("# HELP xclaw_uptime_seconds Process uptime");
  lines.push("# TYPE xclaw_uptime_seconds gauge");
  lines.push(`xclaw_uptime_seconds ${uptimeSec}`);

  let computer = 0;
  try {
    computer = (await isComputerRunning(cfg)) ? 1 : 0;
  } catch {
    computer = 0;
  }
  lines.push("# HELP xclaw_computer_up Computer server health");
  lines.push("# TYPE xclaw_computer_up gauge");
  lines.push(`xclaw_computer_up ${computer}`);
  try {
    const { watchdogStatus } = await import("../computer/watchdog.mjs");
    const w = watchdogStatus();
    lines.push("# HELP xclaw_computer_watchdog_active Watchdog timer active");
    lines.push("# TYPE xclaw_computer_watchdog_active gauge");
    lines.push(`xclaw_computer_watchdog_active ${w.active ? 1 : 0}`);
    lines.push("# HELP xclaw_computer_watchdog_restarts Total watchdog-initiated restarts");
    lines.push("# TYPE xclaw_computer_watchdog_restarts counter");
    lines.push(`xclaw_computer_watchdog_restarts ${w.restartCount || 0}`);
  } catch {
    /* optional */
  }

  try {
    const q = await queueStats(cfg);
    lines.push("# HELP xclaw_queue_jobs Jobs by status");
    lines.push("# TYPE xclaw_queue_jobs gauge");
    for (const st of ["queued", "running", "succeeded", "failed", "cancelled"]) {
      lines.push(`xclaw_queue_jobs{status="${st}"} ${q[st] || 0}`);
    }
    lines.push("# HELP xclaw_queue_dead_letter Failed after maxAttempts");
    lines.push("# TYPE xclaw_queue_dead_letter gauge");
    lines.push(`xclaw_queue_dead_letter ${q.deadLetter || 0}`);
    lines.push("# HELP xclaw_queue_worker_running Active queue workers");
    lines.push("# TYPE xclaw_queue_worker_running gauge");
    lines.push(`xclaw_queue_worker_running ${q.worker?.running || 0}`);
    lines.push("# HELP xclaw_queue_paused Queue worker paused");
    lines.push("# TYPE xclaw_queue_paused gauge");
    lines.push(`xclaw_queue_paused ${q.worker?.paused ? 1 : 0}`);
    try {
      const { subagentMetrics } = await import("../agents/spawn.mjs");
      lines.push("# HELP xclaw_subagents_running In-memory running subagents");
      lines.push("# TYPE xclaw_subagents_running gauge");
      lines.push(`xclaw_subagents_running ${subagentMetrics.running()}`);
      lines.push("# HELP xclaw_subagents_spawned_total Subagents spawned");
      lines.push("# TYPE xclaw_subagents_spawned_total counter");
      lines.push(`xclaw_subagents_spawned_total ${subagentMetrics.spawned}`);
      lines.push("# HELP xclaw_subagents_errors_total Subagent errors");
      lines.push("# TYPE xclaw_subagents_errors_total counter");
      lines.push(`xclaw_subagents_errors_total ${subagentMetrics.errors}`);
      lines.push("# HELP xclaw_subagents_timeouts_total Subagent timeouts");
      lines.push("# TYPE xclaw_subagents_timeouts_total counter");
      lines.push(`xclaw_subagents_timeouts_total ${subagentMetrics.timeouts}`);
    } catch {
      /* optional */
    }
  } catch {
    lines.push("# queue metrics unavailable");
  }

  try {
    const spend = await summarizeEvalSpend(cfg, { limit: 100 });
    lines.push("# HELP xclaw_eval_runs Eval history runs in window");
    lines.push("# TYPE xclaw_eval_runs gauge");
    lines.push(`xclaw_eval_runs ${spend.runs || 0}`);
    lines.push("# HELP xclaw_eval_spend_usd Estimated eval spend USD");
    lines.push("# TYPE xclaw_eval_spend_usd gauge");
    lines.push(`xclaw_eval_spend_usd ${spend.totalUsd || 0}`);
    lines.push("# HELP xclaw_eval_tokens Total tokens in eval window");
    lines.push("# TYPE xclaw_eval_tokens gauge");
    lines.push(`xclaw_eval_tokens ${spend.totalTokens || 0}`);
  } catch {
    lines.push("# eval metrics unavailable");
  }

    lines.push("");
  try {
    const { renderSlackWsPrometheus } = await import("../channels/slack/ws-metrics.mjs");
    lines.push(renderSlackWsPrometheus());
  } catch {
    /* optional */
  }

  // Telegram channel counters
  try {
    const { renderTelegramMetrics } = await import("../channels/telegram/metrics.mjs");
    const tg = renderTelegramMetrics();
    if (tg) lines.push(tg);
  } catch {
    lines.push("# telegram metrics unavailable");
  }

  // Stream resume error counters + lifecycle events
  try {
    const { renderStreamTelemetryPrometheus } = await import("../utils/stream-telemetry.mjs");
    lines.push(renderStreamTelemetryPrometheus().trimEnd());
  } catch {
    lines.push("# stream telemetry unavailable");
  }

  // In-memory stream event log registry
  try {
    const { renderStreamRegistryPrometheus } = await import("./stream-resume.mjs");
    lines.push(renderStreamRegistryPrometheus().trimEnd());
  } catch {
    lines.push("# stream registry metrics unavailable");
  }

  lines.push("");

  try {
    const { renderAgentPrometheus } = await import("../agent/agent-metrics.mjs");
    lines.push(renderAgentPrometheus());
  } catch {
    lines.push("# agent metrics unavailable");
  }

  try {
    const fb = await import("../agent/suggestion-feedback.mjs");
    const store = await fb.loadSuggestionFeedback(cfg);
    const st = fb.suggestionFeedbackStats(store);
    lines.push("# HELP xclaw_suggestion_feedback_shown Durable chip shows");
    lines.push("# TYPE xclaw_suggestion_feedback_shown counter");
    lines.push(`xclaw_suggestion_feedback_shown ${st.shown}`);
    lines.push("# HELP xclaw_suggestion_feedback_tapped Durable chip taps");
    lines.push("# TYPE xclaw_suggestion_feedback_tapped counter");
    lines.push(`xclaw_suggestion_feedback_tapped ${st.tapped}`);
    lines.push("# HELP xclaw_suggestion_feedback_tap_rate Durable chip tap rate");
    lines.push("# TYPE xclaw_suggestion_feedback_tap_rate gauge");
    lines.push(`xclaw_suggestion_feedback_tap_rate ${(st.tapRate || 0).toFixed(4)}`);
  } catch {
    lines.push("# suggestion feedback metrics unavailable");
  }

  return lines.join("\n");
}
