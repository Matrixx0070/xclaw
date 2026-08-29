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
import { runProcess } from "../missions/run-cmd.mjs";
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
export async function requestDeploy(cfg, { missionId, repoDir, mergeCommit, prevKnownGood, drill }) {
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
    // W4: drill intents are marked so their alerts render as [DRILL] and can
    // never be mistaken for a real production deploy incident.
    drill: drill === true,
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

/**
 * Default bound for every subprocess on the deploy path, and one that can
 * actually fire: runProcess spawns into its own process group and signals the
 * GROUP.
 *
 * Passed explicitly at every call site — runProcess's own default is 300s, and
 * silently trebling a deploy-path timeout is not a change this module should
 * make by omission. Overridable per-install via `self.restartTimeoutMs`.
 */
const DEPLOY_TIMEOUT_MS = 120_000;

/**
 * Restart the gateway.
 *
 * This used a local `spawn` without `detached`, so `kill("SIGKILL")` reached
 * only the direct pid. `pm2 restart` is exactly the shape that defeats: work
 * continues in a process the signal never reaches, and the promise settles on
 * 'close', which waits for both stdio streams to EOF — held open by the
 * survivor. Measured against a verbatim copy of that code: a 500ms timeout
 * returned after 6005ms, and returned **code 0**, so the caller was told the
 * command succeeded. There was no exit code by which the overrun could be seen.
 *
 * It matters here more than most places: runDeployWatch awaits runDeployOnce
 * serially, so one grandchild that never exits freezes the whole deployer.
 */
async function restartGateway(cfg) {
  const cmd = cfg.self?.restartCmd || "pm2 restart xclaw-gateway";
  const [exe, ...args] = cmd.split(/\s+/);
  return runProcess(exe, args, {
    cwd: cfg.self?.repoDir || process.cwd(),
    timeoutMs: cfg.self?.restartTimeoutMs ?? DEPLOY_TIMEOUT_MS,
    cfg,
  });
}

async function healthOk(cfg, { retries = 10, delayMs = 3000 } = {}, expectCommit = null) {
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
      // H8: correlate the healthy process to the commit we deployed — a stale
      // still-bound old process or a different service must NOT read as
      // "deployed". We compare the running repo's HEAD (best-effort) to the
      // expected commit; if HEAD can't be read we fall back to ready-only.
      let commitOk = true;
      if (expectCommit) {
        const head = await runProcess("git", ["-C", cfg.self?.repoDir || process.cwd(), "rev-parse", "HEAD"], { timeoutMs: 5000, cfg });
        if (head.code === 0 && head.output.trim()) {
          commitOk = head.output.trim() === expectCommit;
        }
      }
      checks.push({ at: new Date().toISOString(), status: res.status, ready: body.ready === true, commitOk });
      if (res.ok && body.ready === true && commitOk) return { ok: true, checks };
    } catch (e) {
      checks.push({ at: new Date().toISOString(), error: String(e.message || e).slice(0, 100) });
    }
  }
  return { ok: false, checks };
}

async function alertOwner(cfg, title, body, intent = null) {
  // W4: mark drill/rehearsal alerts so a fake "ROLLBACK FAILED" can never be
  // mistaken for a real production incident. Two independent markers so it
  // holds whether the drill runs in-process (env) or is consumed by the
  // out-of-process deploy watcher (intent.drill persisted in the intent file).
  const isDrill = intent?.drill === true || process.env.XCLAW_FIRE_DRILL === "1";
  const prefix = isDrill ? "[DRILL] " : "";
  try {
    const { getSharedAlerter } = await import("../alerting/alerts.mjs");
    await getSharedAlerter(cfg).send({
      key: `self-deploy:${title}`,
      severity: /rolled_back|failed|ROLLBACK/i.test(title) ? "error" : "info",
      title: `${prefix}xclaw self-deploy: ${title}`,
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
 * Is there work in this intent?
 *
 * A resolved intent is never deleted — the live box carried a `rolled_back`
 * fire-drill intent for 14 days — so "a file exists" is NOT the same question
 * as "there is a deploy to run", and anything that treats it as such does work
 * on every tick forever. One predicate, so the watcher and the consumer cannot
 * drift on the answer.
 */
export function isActionableIntent(intent) {
  return intent?.state === "pending" || intent?.state === "restarting";
}

/**
 * Should the rollback rescue uncommitted work before `git reset --hard`?
 *
 * Only when `git status` actually RAN. Grading the output alone treats git's
 * own error text as evidence of uncommitted work — and so does the
 * "[xclaw] command timed out after Nms and was killed" note runProcess appends
 * to a killed command. Either one used to send a `git stash push` at a repo
 * whose status was never read. Measured: with `intent.repoDir` undefined,
 * `git -C undefined status` exits 128 with a non-empty message, which the old
 * `dirty.output.trim()` check read as dirty.
 *
 * Exported because a predicate buried in the rollback branch can only be
 * reached by driving a failing deploy; as a pure function both directions are
 * one assertion each.
 *
 * @param {{code: number, output: string}} status
 */
export function shouldStashBeforeReset(status) {
  return status?.code === 0 && Boolean(status.output?.trim());
}

/**
 * Consume a pending intent: restart → health → resolve. Idempotent — call
 * from a watch loop or once. Returns the final intent (or null if nothing
 * pending).
 */
export async function runDeployOnce(cfg) {
  const intent = await readIntent(cfg);
  if (!isActionableIntent(intent)) return null;
  // H10: a "restarting" intent means the process (expectedly) died mid-deploy
  // before health resolution. Resume it — re-run restart→health rather than
  // stranding the mission forever. Cap attempts so a boot-crash-loop gives up.
  if (intent.state === "restarting") {
    const maxAttempts = cfg.self?.maxDeployAttempts ?? 3;
    if (intent.attempts >= maxAttempts) {
      intent.state = "failed";
      intent.resolvedAt = new Date().toISOString();
      await writeIntent(cfg, intent);
      ledgerDeploy(cfg, intent.missionId, { phase: "abandoned", attempts: intent.attempts });
      await alertOwner(cfg, "ROLLBACK FAILED", `mission ${intent.missionId}: deploy crash-looped ${intent.attempts}× — manual intervention required`, intent);
      return intent;
    }
    // fall through and retry (attempts increments below)
  }

  intent.state = "restarting";
  intent.attempts += 1;
  await writeIntent(cfg, intent);
  ledgerDeploy(cfg, intent.missionId, { phase: "restarting", attempt: intent.attempts });
  await alertOwner(cfg, "deploying", `mission ${intent.missionId} commit ${String(intent.mergeCommit).slice(0, 10)} — restarting gateway`, intent);

  await restartGateway(cfg);
  const health = await healthOk(cfg, cfg.self?.health || {}, intent.mergeCommit);
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
    await alertOwner(cfg, "deployed", `mission ${intent.missionId} live on ${String(intent.mergeCommit).slice(0, 10)} — health OK`, intent);
    return intent;
  }

  // rollback to previous known-good (or the commit before the merge).
  // H7: never silently destroy uncommitted operator work — stash first so a
  // reset is recoverable (git stash list shows the rescue).
  const target = intent.prevKnownGood || `${intent.mergeCommit}~1`;
  ledgerDeploy(cfg, intent.missionId, { phase: "rollback", target });
  const dirty = await runProcess("git", ["-C", intent.repoDir, "status", "--porcelain"], { timeoutMs: DEPLOY_TIMEOUT_MS, cfg });
  if (shouldStashBeforeReset(dirty)) {
    await runProcess("git", ["-C", intent.repoDir, "stash", "push", "-u", "-m", `xclaw-rollback-rescue ${intent.missionId}`], { timeoutMs: DEPLOY_TIMEOUT_MS, cfg });
  }
  const reset = await runProcess("git", ["-C", intent.repoDir, "reset", "--hard", target], { timeoutMs: DEPLOY_TIMEOUT_MS, cfg });
  await restartGateway(cfg);
  const health2 = await healthOk(cfg, cfg.self?.health || {}, target);
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
    `mission ${intent.missionId}: new build failed health checks; ${health2.ok ? `reverted to ${String(target).slice(0, 10)} and recovered` : "manual intervention required"}`,
    intent
  );
  return intent;
}

/**
 * Long-running watcher (run under pm2 / the supervisor).
 *
 * This is the one xclaw process that outlives every config edit — the gateway
 * restarts constantly, the watcher is started once and runs for weeks. Holding
 * the config it booted with meant an alerting target added afterwards never
 * reached it: the live watcher's alerter resolved zero targets for 14 days and
 * every self-deploy alert was skipped "no_targets", `ROLLBACK FAILED`
 * included (that check sits above the severity check in `send()`, so error-level
 * alerts died with the info ones). `getSharedAlerter` already repairs a frozen
 * target-less alerter, but only when a caller hands it a config that resolves
 * targets — which a caller that never re-reads config cannot do.
 *
 * So re-read before acting, and only then: `loadConfig()` logs on every call
 * and this loop ticks every 5s. "Before acting" means an ACTIONABLE intent —
 * a resolved one is never cleaned up (the live box held a `rolled_back` intent
 * for 14 days), so gating on the file's existence would reload 17k times a day
 * and print the config banner with each one. `reload`/`consume` are injectable
 * for tests.
 */
export async function runDeployWatch(cfg, { intervalMs = 5000, signal, reload, consume } = {}) {
  const reloadCfg = reload || (async () => (await import("../config/load.mjs")).loadConfig());
  const consumeOnce = consume || runDeployOnce;
  let current = cfg;
  while (!signal?.aborted) {
    try {
      if (isActionableIntent(await readIntent(current))) {
        try {
          const fresh = await reloadCfg();
          if (fresh) current = fresh;
        } catch {
          /* a half-written config must not strand a pending deploy */
        }
        await consumeOnce(current);
      }
    } catch {
      /* keep watching */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
