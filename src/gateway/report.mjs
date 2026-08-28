/**
 * Human-readable markdown status report from dashboard snapshot.
 */
import { buildDashboard } from "./dashboard.mjs";
// The status report is read by an operator deciding whether a deploy landed;
// it must name the build serving the report, not the one on disk.
import { runningVersion as pkgVersion } from "./build-version.mjs";

export async function buildStatusReport(cfg) {
  const d = await buildDashboard(cfg);
  d.version = pkgVersion();
  const q = d.queue || {};
  const lines = [
    `# XClaw status report`,
    ``,
    `- **At:** ${d.at}`,
    `- **Version:** ${d.version}`,
    `- **Profile:** ${d.profile}`,
    `- **Model:** ${d.agent?.model || "—"} (${d.agent?.provider || "—"})`,
    `- **Computer:** ${d.computer?.up ? "UP" : "DOWN"} (${d.computer?.url || "—"})`,
    `- **Gateway:** ${d.gateway?.host}:${d.gateway?.port}`,
    `- **autoApprove:** ${d.agent?.autoApprove}`,
    ``,
    `## Queue`,
    ``,
    `| Status | Count |`,
    `|--------|-------|`,
    `| queued | ${q.queued ?? 0} |`,
    `| running | ${q.running ?? 0} |`,
    `| succeeded | ${q.succeeded ?? 0} |`,
    `| failed | ${q.failed ?? 0} |`,
    `| cancelled | ${q.cancelled ?? 0} |`,
    `| dead letter | ${q.deadLetter ?? 0} |`,
    `| total | ${q.total ?? 0} |`,
    ``,
    `Worker: concurrency=${q.worker?.concurrency ?? "—"} running=${q.worker?.running ?? "—"} paused=${q.worker?.paused ?? "—"}`,
    ``,
    `## Eval`,
    ``,
    `- Cron registered: ${d.eval?.cron?.registered ? "yes" : "no"}`,
    `- Spend runs: ${d.eval?.spend?.runs ?? 0}`,
    `- Spend total USD (est.): ${d.eval?.spend?.totalUsd ?? 0}`,
    ``,
  ];
  if (d.recentJobs?.length) {
    lines.push(`## Recent jobs`, ``);
    for (const j of d.recentJobs.slice(0, 5)) {
      lines.push(`- \`${j.id}\` ${j.status} turns=${j.turns ?? "—"} — ${(j.goal || "").slice(0, 60)}`);
    }
    lines.push(``);
  }
  return { markdown: lines.join("\n"), dashboard: d };
}
