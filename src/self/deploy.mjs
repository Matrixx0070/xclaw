/**
 * Self-deploy protocol (Mandate-2 slice A4).
 *
 * The gateway cannot supervise its own restart, so deploy is split:
 *   - the missions engine WRITES a deploy intent (~/.xclaw/self-deploy.json)
 *     after a verified self-mission merges (A3 commit + known-good refs);
 *   - an external watcher (xclaw self-deploy watch — run under pm2 or the
 *     gateway supervisor) CONSUMES it: restart → health poll → on pass mark
 *     known-good + mission deployed; on fail git-reset to the previous
 *     known-good, restart again, mission deploy_rolled_back. Owner alert on
 *     every outcome; ledger kind:"deploy" entries throughout.
 *
 * Fully autonomous per operator decision 2026-08-14;
 * cfg.self.requireMergeApproval remains the opt-in brake upstream.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { getConfigDir } from "../config/load.mjs";
import { getSharedLedger } from "../ops/ledger.mjs";

export function deployIntentPath(cfg = {}) {
  return path.join(cfg.paths?.configDir || getConfigDir(), "self-deploy.json");
}

export async function readIntent(cfg) {
  try {
    return JSON.parse(await fs.readFile(deployIntentPath(cfg), "utf8"));
  } catch {
    return null;
  }
}

export async function writeIntent(cfg, intent) {
  const p = deployIntentPath(cfg);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(intent, null, 2), "utf8");
  await fs.rename(tmp, p);
  return intent;
}

/** Written by the engine at self-mission merge. */
export async function requestDeploy(cfg, { missionId, repoDir, mergeCommit, prevKnownGood }) {
  const intent = {
    v: 1,
    missionId,
    repoDir,
    mergeCommit,
    prevKnownGood: prevKnownGood || null,
    requestedAt: new Date().toISOString(),
    state: "pending",
    attempts: 0,
    healthChecks: [],
    resolvedAt: null,
  };
  await writeIntent(cfg, intent);
  ledgerDeploy(cfg, missionId, { phase: "requested", mergeCommit });
  return intent;
}

function ledgerDeploy(cfg, missionId, data) {
  try {
    getSharedLedger(cfg).append({
      kind: "deploy",
      ids: { missionId },
      actor: "supervisor",
      data,
    });
  } catch {}
}

function run(cmd, args, cwd, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: false });
    let output = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);
    child.stdout?.on("data", (d) => (output += d));
    child.stderr?.on("data", (d) => (output += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 1, output: e.message });
    });
  });
}

async function restartGateway(cfg) {
  const cmd = cfg.self?.restartCmd || "pm2 restart xclaw-gateway";
  const [exe, ...args] = cmd.split(/\s+/);
  return run(exe, args, cfg.self?.repoDir || process.cwd());
}

async function healthOk(cfg, { retries = 10, delayMs = 3000 } = {}) {
  const host = cfg.gateway?.host || "127.0.0.1";
  const port = cfg.gateway?.port || 18790;
  const checks = [];
  for (let i = 0; i < retries; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      const res = await fetch(`http://${host}:${port}/ready`, {
        signal: AbortSignal.timeout(5000),
      });
      const body = await res.json().catch(() => ({}));
      checks.push({ at: new Date().toISOString(), status: res.status, ready: body.ready === true });
      if (res.ok && body.ready === true) return { ok: true, checks };
    } catch (e) {
      checks.push({ at: new Date().toISOString(), error: String(e.message || e).slice(0, 100) });
    }
  }
  return { ok: false, checks };
}

async function alertOwner(cfg, title, body) {
  try {
    const { getSharedAlerter } = await import("../alerting/alerts.mjs");
    await getSharedAlerter(cfg).alert({
      key: `self-deploy:${title}`,
      severity: /rolled_back|failed/.test(title) ? "error" : "info",
      title: `xclaw self-deploy: ${title}`,
      body,
    });
  } catch {
    /* alerting must not block deploys */
  }
}

async function markMission(cfg, missionId, status, note) {
  try {
    const { loadMission, saveMission, addEvent } = await import("../missions/store.mjs");
    const m = await loadMission(cfg, missionId);
    if (!m) return;
    m.status = status;
    addEvent(m, "deploy", note);
    await saveMission(cfg, m);
  } catch {}
}

/**
 * Consume a pending intent: restart → health → resolve. Idempotent — call
 * from a watch loop or once. Returns the final intent (or null if nothing
 * pending).
 */
export async function runDeployOnce(cfg) {
  const intent = await readIntent(cfg);
  if (!intent || intent.state !== "pending") return null;

  intent.state = "restarting";
  intent.attempts += 1;
  await writeIntent(cfg, intent);
  ledgerDeploy(cfg, intent.missionId, { phase: "restarting", attempt: intent.attempts });
  await alertOwner(cfg, "deploying", `mission ${intent.missionId} commit ${String(intent.mergeCommit).slice(0, 10)} — restarting gateway`);

  await restartGateway(cfg);
  const health = await healthOk(cfg, cfg.self?.health || {});
  intent.healthChecks = health.checks.slice(-10);

  if (health.ok) {
    intent.state = "healthy";
    intent.resolvedAt = new Date().toISOString();
    await writeIntent(cfg, intent);
    try {
      const { markKnownGood } = await import("../git/timeline.mjs");
      await markKnownGood(intent.repoDir, { sha: intent.mergeCommit, note: intent.missionId });
    } catch {}
    await markMission(cfg, intent.missionId, "deployed", `deployed ${String(intent.mergeCommit).slice(0, 10)} — health OK`);
    ledgerDeploy(cfg, intent.missionId, { phase: "deployed", commit: intent.mergeCommit });
    await alertOwner(cfg, "deployed", `mission ${intent.missionId} live on ${String(intent.mergeCommit).slice(0, 10)} — health OK`);
    return intent;
  }

  // rollback to previous known-good (or the commit before the merge)
  const target = intent.prevKnownGood || `${intent.mergeCommit}~1`;
  ledgerDeploy(cfg, intent.missionId, { phase: "rollback", target });
  const reset = await run("git", ["-C", intent.repoDir, "reset", "--hard", target]);
  await restartGateway(cfg);
  const health2 = await healthOk(cfg, cfg.self?.health || {});
  intent.state = health2.ok ? "rolled_back" : "failed";
  intent.resolvedAt = new Date().toISOString();
  await writeIntent(cfg, intent);
  await markMission(
    cfg,
    intent.missionId,
    "deploy_rolled_back",
    `health failed → rolled back to ${String(target).slice(0, 16)} (${health2.ok ? "recovered" : `RECOVERY FAILED: ${reset.output.slice(0, 100)}`})`
  );
  ledgerDeploy(cfg, intent.missionId, {
    phase: health2.ok ? "rolled_back" : "rollback_failed",
    target,
  });
  await alertOwner(
    cfg,
    health2.ok ? "rolled_back" : "ROLLBACK FAILED",
    `mission ${intent.missionId}: new build failed health checks; ${health2.ok ? `reverted to ${String(target).slice(0, 10)} and recovered` : "manual intervention required"}`
  );
  return intent;
}

/** Long-running watcher (run under pm2 / the supervisor). */
export async function runDeployWatch(cfg, { intervalMs = 5000, signal } = {}) {
  // eslint-disable-next-line no-constant-condition
  while (!signal?.aborted) {
    try {
      await runDeployOnce(cfg);
    } catch {
      /* keep watching */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
