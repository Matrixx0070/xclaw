/**
 * Phase 7.4 — XClaw doctor (health + config checks)
 * Exit codes: 0 ok, 1 warnings only, 2 errors
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import http from "node:http";
import { loadConfig, getConfigPath, getConfigDir } from "../config/load.mjs";
import { validateConfig } from "../config/validate.mjs";
import { isComputerRunning } from "../computer/manager.mjs";
import { runSecurityAudit } from "../security/audit.mjs";
import { isMitmEnabled, mitmStatus, findMitmdump, mitmCaStatus } from "../browser/mitm.mjs";
import { horizon0Checklist, buildProductionChromeArgs } from "../browser/horizon0.mjs";
import { hooksStatus, beforeNavigate, beforeInput } from "../browser/hooks.mjs";
import { resolveHooksModulePath } from "../computer/hooks-bridge.mjs";
import { loadMotor } from "../computer/motor-bridge.mjs";
import { loadChromeArgsModule } from "../computer/chrome-args-bridge.mjs";
import { buildChromeArgs, chromeArgsInvariants } from "../computer/chrome-args.mjs";
import fsSync from "node:fs";


function httpGet(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "GET",
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ ok: res.statusCode < 500, status: res.statusCode, data }));
      }
    );
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
    req.end();
  });
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.json]
 */
export async function runDoctor(opts = {}) {
  const checks = [];
  const push = (id, status, message, detail) => {
    checks.push({ id, status, message, detail });
  };

  let cfg;
  try {
    cfg = await loadConfig({ strict: false });
    push("config.load", "ok", `Loaded ${getConfigPath()}`);
  } catch (err) {
    push("config.load", "error", err.message);
    return finish(checks, opts);
  }

  const v = validateConfig(cfg);
  if (v.ok) push("config.validate", "ok", "Config validation passed");
  else {
    push("config.validate", "error", v.errors.join("; "));
    for (const d of v.details || []) {
      push(
        `config.detail.${d.path || d.code || "unknown"}`,
        "error",
        `${d.message}${d.hint ? " — " + d.hint : ""}${d.got !== undefined ? " (got: " + JSON.stringify(d.got) + ")" : ""}`
      );
    }
  }
  for (const w of v.warnings) push("config.warn", "warn", w);

  // Profile pack vs effective security (mismatch detector) — F
  try {
    const { profileMismatchChecks } = await import("./doctor-prod-honesty.mjs");
    for (const c of profileMismatchChecks(cfg)) {
      push(c.id, c.status, c.message);
    }
  } catch (e) {
    push("profile", "warn", e.message || String(e));
  }

  // SSRF guard on agent-controlled fetches (web_fetch)
  try {
    const { getSsrfPolicy } = await import("../security/ssrf.mjs");
    const sp = getSsrfPolicy(cfg);
    if (sp.mode === "off") {
      push("security.ssrf", "warn", "SSRF guard OFF — web_fetch can reach loopback/metadata/private IPs");
    } else if (sp.allowPrivate) {
      push("security.ssrf", "warn", "SSRF guard on but allowPrivate=true (lab dev) — private/loopback permitted");
    } else {
      push(
        "security.ssrf",
        "ok",
        `SSRF guard=block (allowHosts=${sp.allowHosts.length}, maxRedirects=${sp.maxRedirects})`
      );
    }
  } catch (e) {
    push("security.ssrf", "warn", e.message || String(e));
  }

  // SCAFFOLD surfacing: Anthropic OAuth path spoofs the Claude Code client
  // identity (attestation + user-agent). Warn whenever an OAuth token is in
  // reach so the operator knows the dependency exists.
  try {
    const candidates = [
      cfg.agent?.apiKey,
      process.env.ANTHROPIC_API_KEY,
      process.env.CLAUDE_CODE_OAUTH_TOKEN,
      process.env.ANTHROPIC_AUTH_TOKEN,
    ];
    if (candidates.some((t) => String(t || "").startsWith("sk-ant-oat"))) {
      push(
        "security.oauthIdentity",
        "warn",
        "Anthropic OAuth token in use — requests carry the Claude Code client identity (SCAFFOLD, see src/providers/anthropic-oauth-headers.mjs)"
      );
    }
  } catch {
    /* informational only */
  }

  // WebSocket upgrade auth
  try {
    const prof = cfg.profile || process.env.XCLAW_PROFILE || "lab";
    const token = cfg.gateway?.token || process.env.XCLAW_GATEWAY_TOKEN || null;
    const requireAuth =
      cfg.gateway?.requireAuth === true || prof === "prod";
    if (token || requireAuth) {
      push("security.wsAuth", "ok", "WS /ws/events requires token (upgrade authorized before 101)");
    } else {
      push("security.wsAuth", "ok", `WS open (no token, profile=${prof}) — loopback lab default`);
    }
  } catch (e) {
    push("security.wsAuth", "warn", e.message || String(e));
  }

  // Egress + kill-switch (philosophy: privacy + always killable)
  try {
    const { getEgressPolicy } = await import("../security/egress.mjs");
    const eg = getEgressPolicy(cfg);
    const prof = cfg.profile || process.env.XCLAW_PROFILE || "lab";
    if (prof === "prod" && eg.mode === "allow") {
      push(
        "security.egress",
        "warn",
        'prod profile with egress mode=allow — outbound shell network is open; set security.egress.mode=deny or allowlist'
      );
    } else {
      push(
        "security.egress",
        "ok",
        `egress mode=${eg.mode} allowHosts=${(eg.allowHosts || []).length}`
      );
    }
  } catch (e) {
    push("security.egress", "warn", e.message || String(e));
  }
  try {
    const { listActiveSessions } = await import("../agent/session-control.mjs");
    const n = listActiveSessions().length;
    push(
      "security.killSwitch",
      "ok",
      `session kill-switch ready (activeSessions=${n}); use: xclaw stop-all`
    );
  } catch (e) {
    push("security.killSwitch", "warn", e.message || String(e));
  }

  // F — prod honesty (defaults must match the label)
  try {
    const { prodHonestyChecks } = await import("./doctor-prod-honesty.mjs");
    for (const c of prodHonestyChecks(cfg)) {
      push(c.id, c.status, c.message);
    }
  } catch (e) {
    push("security.prodHonesty", "warn", e.message || String(e));
  }

  try {
    const { findBwrap, getOsSandboxMode } = await import("../security/os-sandbox.mjs");
    const mode = getOsSandboxMode(cfg);
    const bw = findBwrap();
    const prof = cfg.profile || process.env.XCLAW_PROFILE || "lab";
    if (mode === "bwrap" && !bw) {
      push("security.osSandbox", "error", "osSandbox=bwrap but bubblewrap not installed");
    } else if (prof === "prod" && !bw) {
      push(
        "security.osSandbox",
        "warn",
        `prod without bwrap (mode=${mode}) — install bubblewrap for OS isolation of bash`
      );
    } else {
      push(
        "security.osSandbox",
        "ok",
        `mode=${mode} bwrap=${bw || "not-found"}`
      );
    }
  } catch (e) {
    push("security.osSandbox", "warn", e.message || String(e));
  }

  // R3 owner safety
  try {
    const prof = cfg.profile || "lab";
    const token =
      cfg.gateway?.token ||
      process.env.XCLAW_GATEWAY_TOKEN ||
      process.env.GATEWAY_TOKEN ||
      null;
    if (prof === "prod" && !token) {
      push(
        "owner.gatewayToken",
        "error",
        'profile is "prod" but no gateway.token / XCLAW_GATEWAY_TOKEN — set a token before exposing the gateway'
      );
    } else if (!token) {
      push(
        "owner.gatewayToken",
        "warn",
        "no gateway token (ok for lab localhost; required for prod)"
      );
    } else {
      push("owner.gatewayToken", "ok", "gateway token configured");
    }
    const linkDm =
      cfg.security?.linkDmOnly !== false && cfg.channels?.linkDmOnly !== false;
    push(
      "owner.linkDmOnly",
      "ok",
      linkDm
        ? "/link issue+redeem restricted to DMs"
        : "linkDmOnly disabled — codes allowed in groups (risky)"
    );
    // channel allowlist hints
    for (const name of ["telegram", "discord", "slack"]) {
      const ch = cfg.channels?.[name];
      if (!ch?.enabled) continue;
      const hasList =
        (name === "telegram" && (ch.allowedChatIds?.length || ch.allowFrom?.length)) ||
        (name === "discord" && ch.allowedChannelIds?.length) ||
        (name === "slack" && ch.channelIds?.length);
      if (!hasList && (ch.dmPolicy === "open" || !ch.dmPolicy)) {
        push(
          "owner.allowlist." + name,
          "warn",
          `${name} enabled without tight allowlist — prefer allowedChatIds / channelIds / dmPolicy=pairing`
        );
      } else {
        push("owner.allowlist." + name, "ok", `${name} has scoping config`);
      }
    }
  } catch (e) {
    push("owner.safety", "warn", e.message || String(e));
  }

    // Node version
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) push("node", "ok", `Node ${process.version}`);
  else push("node", "error", `Node ${process.version} — require >= 22`);

  // API key presence (not validity)
  const key =
    cfg.agent?.apiKey ||
    process.env.XCLAW_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.XAI_API_KEY;
  if (key) push("apiKey", "ok", "API key present (env or config)");
  else push("apiKey", "warn", "No API key — remote providers will fail");

  // Paths
  try {
    await fs.access(cfg.paths.configDir);
    push("paths.configDir", "ok", cfg.paths.configDir);
  } catch {
    push("paths.configDir", "error", `Missing ${cfg.paths.configDir}`);
  }

  // Bind safety
  const host = cfg.gateway?.host || "127.0.0.1";
  if (host === "127.0.0.1" || host === "localhost") {
    push("bind", "ok", `Gateway host ${host} (local)`);
  } else {
    push("bind", "warn", `Gateway host ${host} may be publicly reachable`);
  }

  // Retry config
  const r = cfg.retry || {};
  push(
    "retry",
    "ok",
    `strategy=${r.strategy || "full"} retries=${r.retries ?? 3} maxDelayMs=${r.maxDelayMs ?? 30000}`
  );

  // Security
  if (cfg.security?.autoApprove) {
    push("security.autoApprove", "warn", "autoApprove=true — tools may run without human gate");
  } else {
    push("security.autoApprove", "ok", "autoApprove disabled or unset");
  }

  // Phase S security audit
  try {
    const audit = runSecurityAudit(cfg);
    for (const f of audit.findings) {
      if (f.level === "ok" || f.level === "info") {
        if (f.level === "ok") push(`security.${f.id}`, "ok", f.message);
        else push(`security.${f.id}`, "ok", f.message);
      } else if (f.level === "warn") {
        push(`security.${f.id}`, "warn", f.fix ? `${f.message} — ${f.fix}` : f.message);
      } else {
        push(`security.${f.id}`, "error", f.fix ? `${f.message} — ${f.fix}` : f.message);
      }
    }
  } catch (err) {
    push("security.audit", "warn", err.message);
  }

  // S3–S4 swarm merge governance
  try {
    const sw = cfg.swarm || {};
    if (sw.enabled === false) {
      push("swarm", "ok", "swarm.enabled=false");
    } else {
      push(
        "swarm.merge",
        "ok",
        `autoMerge=${sw.autoMerge === true} requireVerify=${sw.mergeRequireVerify !== false} requireCleanMain=${sw.mergeRequireCleanMain === true} useIndex=${sw.mergeUseIndex === true}`
      );
      if (sw.autoMerge === true && (cfg.profile === "prod")) {
        push(
          "swarm.autoMerge.prod",
          "warn",
          "swarm.autoMerge=true under prod profile — patches apply without owner approval"
        );
      }
      if (sw.mergeRequireCleanMain === true) {
        push(
          "swarm.merge.cleanMain",
          "ok",
          "mergeRequireCleanMain on — main must be fully clean before merge/approve"
        );
      }
      // Pending proposals
      try {
        const { listMergeProposals } = await import(
          "../agents/swarm-merge.mjs"
        );
        const pending = await listMergeProposals(cfg, {
          status: "pending",
          limit: 20,
        });
        push(
          "swarm.merge.proposals",
          pending.length > 5 ? "warn" : "ok",
          `pending merge proposals: ${pending.length}`
        );
      } catch (e) {
        push("swarm.merge.proposals", "warn", e.message || String(e));
      }
    }
  } catch (e) {
    push("swarm", "warn", e.message || String(e));
  }

  // Git credential helper status
  try {
    const { gitCredentialHelperStatus } = await import("../git/credential.mjs");
    const st = await gitCredentialHelperStatus(process.cwd());
    if (!st.ok) {
      push("git.credential", "warn", st.error || "cannot read credential config");
    } else if (!st.configured) {
      push(
        "git.credential",
        "warn",
        "no credential.helper configured — HTTPS may fail headless (set helper or XCLAW_GIT_TOKEN)"
      );
    } else {
      push(
        "git.credential",
        "ok",
        `helpers: ${st.helpers.join(", ") || "configured"}`
      );
    }
  } catch (e) {
    push("git.credential", "warn", e.message || String(e));
  }

  // SSH certificates (optional CA-issued)
  try {
    const { sshCaStatus } = await import("../git/ssh-ca.mjs");
    const st = await sshCaStatus();
    if (!st.certificates?.length) {
      push("ssh.certs", "ok", "no user SSH certificates in ~/.ssh (*-cert.pub)");
    } else if (st.anyExpired) {
      push(
        "ssh.certs",
        "warn",
        `SSH certificate expired — renew: ${st.certificates
          .filter((c) => c.expired)
          .map((c) => c.path)
          .join(", ")}`
      );
    } else if (st.anyExpiringSoon) {
      push(
        "ssh.certs",
        "warn",
        "SSH certificate expires within 7 days — plan renewal"
      );
    } else {
      push(
        "ssh.certs",
        "ok",
        `${st.certificates.length} SSH certificate(s) present`
      );
    }
  } catch (e) {
    push("ssh.certs", "warn", e.message || String(e));
  }

  // Git remote URL validation (cwd if a repo)
  try {
    const { listAndValidateRemotes } = await import("../agents/worktree.mjs");
    const cwd = process.cwd();
    const rem = await listAndValidateRemotes(cwd, {
      allowHttp: cfg.git?.allowHttp === true,
      allowGitProtocol: cfg.git?.allowGitProtocol === true,
      allowedHosts: cfg.git?.allowedRemoteHosts || null,
    });
    if (rem.error === "not a git repository") {
      push("git.remotes", "ok", "cwd is not a git repo (skip remote check)");
    } else if (!rem.ok) {
      const errs = rem.validation?.errors || [];
      push(
        "git.remotes",
        "warn",
        errs.length
          ? errs.map((e) => `${e.name}: ${e.error || e.code}`).join("; ")
          : rem.error || "remote validation failed"
      );
    } else {
      const n = rem.validation?.results?.length || 0;
      const warns = rem.validation?.warnings?.length || 0;
      push(
        "git.remotes",
        warns ? "warn" : "ok",
        n
          ? `${n} remote URL(s) valid${warns ? ` (${warns} warning(s))` : ""}`
          : "no remotes configured"
      );
    }
  } catch (e) {
    push("git.remotes", "warn", e.message || String(e));
  }

  // Live endpoints (optional)
  const gPort = cfg.gateway?.port || 18790;
  const cPort = cfg.computer?.port || 4243;
  const gHost = cfg.gateway?.host || "127.0.0.1";
  const cHost = cfg.computer?.host || "127.0.0.1";

  const gh = await httpGet(`http://${gHost === "0.0.0.0" ? "127.0.0.1" : gHost}:${gPort}/health`);
  if (gh.ok) push("gateway.health", "ok", `Gateway :${gPort} up`);
  else push("gateway.health", "warn", `Gateway :${gPort} not reachable (${gh.error || gh.status})`);
  // In-process ops state from the RUNNING gateway — the doctor's own process
  // cannot see cron/watchdog registrations, which made those checks warn
  // "start gateway" while the gateway was demonstrably up.
  let liveOps = null;
  if (gh.ok) {
    try {
      const info = await httpGet(`http://${gHost === "0.0.0.0" ? "127.0.0.1" : gHost}:${gPort}/gateway/info`);
      if (info.ok && info.data) {
        try { liveOps = JSON.parse(info.data)?.ops || null; } catch { /* not json */ }
      }
    } catch { /* fall back to in-process view */ }
  }

  const ch = await httpGet(`http://${cHost === "0.0.0.0" ? "127.0.0.1" : cHost}:${cPort}/health`);
  if (ch.ok) push("computer.health", "ok", `Computer :${cPort} up`);
  else {
    let running = false;
    try { running = await isComputerRunning(cfg); } catch {}
    push(
      "computer.health",
      running ? "ok" : "warn",
      running
        ? `Computer :${cPort} up (probe)`
        : `Computer :${cPort} not reachable — start with: xclaw gateway (${ch.error || ch.status})`
    );
  }
  try {
    const { watchdogStatus } = await import("../computer/watchdog.mjs");
    const w = watchdogStatus();
    const enabled = cfg.computer?.watchdog?.enabled !== false;
    const active = w.active || liveOps?.computerWatchdogActive === true;
    push(
      "computer.watchdog",
      enabled ? (active ? "ok" : "warn") : "ok",
      enabled
        ? (active
            ? `active every ${cfg.computer?.watchdog?.intervalMs ?? 30000}ms${w.active ? "" : " (in gateway)"}`
            : "enabled but not running (start gateway)")
        : "disabled"
    );
  } catch (err) {
    push("computer.watchdog", "warn", err.message);
  }

  
  // Queue + eval cron
  try {
    const { listQueue } = await import("../jobs/queue.mjs");
    const q = await listQueue(cfg, { limit: 100 });
    const queued = q.filter((i) => i.status === "queued").length;
    const running = q.filter((i) => i.status === "running").length;
    push("queue.depth", queued > 20 ? "warn" : "ok", `queued=${queued} running=${running} total=${q.length}`);
  } catch (err) {
    push("queue.depth", "warn", err.message);
  }
  try {
    const { checkSpendThresholds } = await import("../eval/spend-alerts.mjs");
    if (cfg.eval?.spend?.maxUsdPerWindow != null || cfg.eval?.spend?.maxRunsPerWindow != null) {
      const sp = await checkSpendThresholds(cfg, {});
      push(
        "eval.spend",
        sp.ok ? "ok" : "warn",
        sp.ok
          ? `within limits (usd=${sp.summary?.totalUsd ?? 0})`
          : `threshold: ${sp.breaches?.join("; ")}`
      );
    } else {
      push("eval.spend", "ok", "no spend caps configured");
    }
  } catch (err) {
    push("eval.spend", "warn", err.message);
  }
  try {
    const { evalCronStatus } = await import("../cron/eval-job.mjs");
    const st = evalCronStatus();
    const registered = st.registered || liveOps?.evalCronRegistered === true;
    push(
      "eval.cron",
      registered ? "ok" : "warn",
      registered
        ? st.registered
          ? `registered next=${st.job?.nextRunAt ? new Date(st.job.nextRunAt).toISOString() : "—"}`
          : "registered (in gateway)"
        : "not registered (start gateway)"
    );
  } catch (err) {
    push("eval.cron", "warn", err.message);
  }
  try {
    const { countStaleTmp } = await import("../ops/tmp-sweeper.mjs");
    const stale = await countStaleTmp(cfg);
    push(
      "ops.tmp",
      stale > 50 ? "warn" : "ok",
      stale > 50
        ? `${stale} stale xclaw tmp entries (>24h) — run: xclaw sweep-tmp`
        : `${stale} stale tmp entries`
    );
  } catch (err) {
    push("ops.tmp", "warn", err.message);
  }

  // Long-run objectives needing attention: a missed escalation DM used to
  // leave an awaiting_human mission invisible forever.
  try {
    const { listObjectives } = await import("../agent/objective-store.mjs");
    const active = await listObjectives(cfg, { activeOnly: true });
    const staleMs = 60 * 60 * 1000;
    const attention = active.filter(
      (o) =>
        ["awaiting_human", "interrupted", "paused_budget"].includes(o.status) &&
        Date.now() - Date.parse(o.updatedAt || 0) > staleMs
    );
    push(
      "objectives.attention",
      attention.length ? "warn" : "ok",
      attention.length
        ? `${attention.length} mission(s) waiting >1h: ` +
            attention.map((o) => `${o.id}(${o.status})`).join(", ") +
            " — /objective resume <id> or GET /objectives"
        : `${active.length} active mission(s), none stuck`
    );
  } catch (err) {
    push("objectives.attention", "warn", err.message);
  }



  // P5: connected OAuth token health
  try {
    const { listConnectedApps } = await import("../connected/token-store.mjs");
    const apps = await listConnectedApps(cfg);
    if (!apps.length) {
      push("connected.tokens", "ok", "no connected OAuth tokens stored");
    } else {
      const now = Date.now();
      for (const a of apps) {
        if (a.invalidatedAt) {
          push("connected.tokens." + a.id, "warn", `invalidated — re-login required`);
          continue;
        }
        if (!a.hasToken) {
          push("connected.tokens." + a.id, "warn", "entry without access token");
          continue;
        }
        if (a.expiresAt) {
          const left = Date.parse(a.expiresAt) - now;
          if (left <= 0) {
            push(
              "connected.tokens." + a.id,
              a.hasRefreshToken ? "warn" : "error",
              `expired ${a.expiresAt}` + (a.hasRefreshToken ? " (has refresh)" : " — re-login")
            );
          } else if (left < 24 * 3600_000) {
            push(
              "connected.tokens." + a.id,
              "warn",
              `expires in ${Math.round(left / 3600000)}h (${a.expiresAt})`
            );
          } else {
            push("connected.tokens." + a.id, "ok", `valid until ${a.expiresAt}`);
          }
        } else {
          push("connected.tokens." + a.id, "ok", "token present (no expiry)");
        }
      }
    }
  } catch (e) {
    push("connected.tokens", "warn", e.message || String(e));
  }


  // S0 swarm / subagents
  try {
    const { listSubagents, subagentMetrics } = await import("../agents/spawn.mjs");
    const { listPersistedSubagents, listSwarmRuns } = await import("../agents/swarm-store.mjs");
    const live = listSubagents();
    const running = live.filter((s) => s.status === "running");
    const stuckMs = 15 * 60_000;
    const stuck = running.filter((s) => {
      const t0 = Date.parse(s.createdAt || 0);
      return t0 && Date.now() - t0 > stuckMs;
    });
    push(
      "swarm.agents",
      stuck.length ? "warn" : "ok",
      `live=${live.length} running=${running.length} spawned=${subagentMetrics.spawned} errors=${subagentMetrics.errors} timeouts=${subagentMetrics.timeouts}` +
        (stuck.length ? ` stuck=${stuck.length}` : "")
    );
    const persisted = await listPersistedSubagents(cfg, { limit: 20 });
    const interrupted = persisted.filter((s) => s.status === "interrupted");
    if (interrupted.length) {
      push("swarm.persisted", "warn", `${interrupted.length} interrupted agent snapshot(s) after restart`);
    } else {
      push("swarm.persisted", "ok", `snapshots=${persisted.length}`);
    }
    const runs = await listSwarmRuns(cfg, { limit: 10 });
    const open = runs.filter((r) => r.status === "running");
    push(
      "swarm.runs",
      open.length ? "warn" : "ok",
      open.length ? `${open.length} open SwarmRun(s)` : `runs=${runs.length}`
    );
  } catch (e) {
    push("swarm", "warn", e.message || String(e));
  }

  // R5 learning
  try {
    const dir = (await import("node:path")).default.join(
      cfg.paths?.configDir || "",
      "skill-proposals"
    );
    const fs = await import("node:fs/promises");
    let n = 0;
    try {
      n = (await fs.readdir(dir)).filter((f) => f.endsWith(".md")).length;
    } catch {
      n = 0;
    }
    push(
      "skills.proposals",
      "ok",
      n ? `${n} draft proposal(s) in skill-proposals/` : "no skill drafts pending"
    );
    // Manifest-first skill integrity (skills.lock.json)
    try {
      const integrity = await import("../skills/integrity.mjs");
      const { loadAllSkills } = await import("../skills/loader.mjs");
      const { path: lockPath, data } = await integrity.readLockfile(process.cwd());
      const prod = String(cfg.profile || "").toLowerCase() === "prod";
      if (!data) {
        push(
          "skills.integrity",
          prod ? "warn" : "ok",
          prod
            ? `no ${integrity.LOCKFILE_NAME} — prod injects unpinned skills (run: xclaw skills lock)`
            : `no ${integrity.LOCKFILE_NAME} (integrity off — optional: xclaw skills lock)`
        );
      } else {
        const rawCfg = { ...cfg, skills: { ...(cfg.skills || {}), integrity: "off" } };
        const skills = await loadAllSkills({
          configDir: cfg.paths?.configDir,
          cwd: process.cwd(),
          cfg: rawCfg,
        });
        const { evaluated, missing } = await integrity.evaluateSkills(skills, data);
        const drift = evaluated.filter((e) => e.status !== "verified").length + missing.length;
        const mode = integrity.resolveIntegrityMode(cfg, true);
        push(
          "skills.integrity",
          drift ? "warn" : "ok",
          drift
            ? `${drift} skill(s) drifted from ${lockPath} (mode=${mode}) — xclaw skills verify`
            : `${evaluated.length} skill(s) verified against lockfile (mode=${mode})`
        );
      }
    } catch (ie) {
      push("skills.integrity", "warn", ie?.message || String(ie));
    }
    const pref = (await import("node:path")).default.join(
      cfg.paths?.configDir || "",
      "memory",
      "preferences.md"
    );
    try {
      await fs.access(pref);
      push("memory.preferences", "ok", "preferences.md present");
    } catch {
      push("memory.preferences", "ok", "no preferences.md yet");
    }
  } catch (e) {
    push("skills.learning", "warn", e.message || String(e));
  }

  // R4 autonomy heartbeat
  try {
    const { heartbeatStatus } = await import("../cron/heartbeat.mjs");
    const hb = cfg.autonomy?.heartbeat || {};
    const st = heartbeatStatus();
    if (hb.enabled !== true) {
      push("autonomy.heartbeat", "ok", "disabled (set autonomy.heartbeat.enabled: true)");
    } else {
      push(
        "autonomy.heartbeat",
        st.lastError ? "warn" : "ok",
        st.lastError ||
          `enabled lastRun=${st.lastRunAt || "—"} skip=${st.lastSkipReason || "—"} spend=${st.spendUsdToday || 0}`
      );
    }
  } catch (e) {
    push("autonomy.heartbeat", "warn", e.message || String(e));
  }

  // R1 channel + computer health
  try {
    const { channelHealthStatus } = await import("../channels/health-watchdog.mjs");
    const { watchdogStatus } = await import("../computer/watchdog.mjs");
    const ch = channelHealthStatus();
    if (!ch.running) {
      push("channels.health", "ok", "channel watchdog idle (start gateway to enable)");
    } else {
      const parts = Object.entries(ch.channels || {}).map(
        ([n, s]) => `${n}:restarts=${s.restarts||0}${s.lastError ? ":err" : ""}`
      );
      push(
        "channels.health",
        ch.lastError ? "warn" : "ok",
        ch.lastError || `watchdog up lastTick=${ch.lastTickAt || "—"} ${parts.join(" ") || "(no channel state yet)"}`
      );
    }
    const cw = watchdogStatus();
    if (cw) {
      push(
        "computer.watchdog",
        cw.lastError ? "warn" : "ok",
        cw.lastError ||
          `checks ok restarts=${cw.restartCount ?? 0} last=${cw.lastCheckAt || "—"}`
      );
    }
  } catch (e) {
    push("channels.health", "warn", e.message || String(e));
  }

    // Account linking + vault consistency (L1–L3)
  try {
    const {
      listAccounts,
      loadAccountStore,
    } = await import("../connected/account-links.mjs");
    const { vaultListUsers, vaultListApps } = await import("../connected/vault.mjs");
    const listed = await listAccounts(cfg);
    const accounts = listed.accounts || [];
    const links = listed.links || {};
    const linkCount = Object.keys(links).length;

    if (!accounts.length && !linkCount) {
      push("accounts", "ok", "no linked accounts (optional)");
    } else {
      push(
        "accounts",
        "ok",
        `${accounts.length} account(s), ${linkCount} identity link(s)`
      );
    }

    // Orphan links: identity points at missing account
    for (const [identity, accId] of Object.entries(links)) {
      if (!listed.accounts?.length || !accounts.find((a) => a.id === accId)) {
        // reload via store for safety
        const store = await loadAccountStore(cfg);
        if (!store.accounts[accId]) {
          push(
            "accounts.link." + identity.replace(/[^a-zA-Z0-9:_@.+-]/g, "_"),
            "error",
            `orphan link ${identity} → ${accId} (account missing)`
          );
        }
      }
    }

    // Account with zero identities
    for (const acc of accounts) {
      if (!acc.identities?.length) {
        push("accounts." + acc.id, "warn", "account has no identities");
      } else {
        push(
          "accounts." + acc.id,
          "ok",
          `${acc.identities.length} identities: ${acc.identities.join(", ")}`
        );
      }
    }

    // Pairing codes: expired / active
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const pairPath = path.join(
        cfg.paths?.configDir || "",
        "accounts",
        "pairing.json"
      );
      let pairing = { codes: {} };
      try {
        pairing = JSON.parse(await fs.readFile(pairPath, "utf8"));
      } catch {
        /* none */
      }
      const now = Date.now();
      const codes = Object.entries(pairing.codes || {});
      let active = 0;
      let expired = 0;
      for (const [, rec] of codes) {
        if (rec.expiresAt && rec.expiresAt <= now) expired += 1;
        else active += 1;
      }
      if (!codes.length) {
        push("accounts.pairing", "ok", "no pending pairing codes");
      } else {
        push(
          "accounts.pairing",
          expired && !active ? "warn" : "ok",
          `active=${active} expired=${expired}`
        );
      }
    } catch (e) {
      push("accounts.pairing", "warn", e.message);
    }

    // Vault users vs links
    const vaultUsers = await vaultListUsers(cfg);
    const linkedIds = new Set(Object.keys(links));
    const accountIds = new Set(accounts.map((a) => a.id));
    for (const vu of vaultUsers) {
      // skip bak leftovers
      if (String(vu).includes(".bak-")) continue;
      if (accountIds.has(vu)) {
        const apps = await vaultListApps(cfg, vu);
        push(
          "accounts.vault." + vu,
          "ok",
          `account vault apps=${apps.length}`
        );
        continue;
      }
      if (linkedIds.has(vu)) {
        // identity still has its own vault folder (not yet migrated or backup failed)
        push(
          "accounts.vault." + vu.replace(/[^a-zA-Z0-9:_@.+-]/g, "_"),
          "warn",
          `identity vault present (${vu}) — run: xclaw auth accounts migrate <accountId>`
        );
        continue;
      }
      // unlinked identity vault — ok for single-channel users
      if (vu.includes(":")) {
        push(
          "accounts.vault." + vu.replace(/[^a-zA-Z0-9:_@.+-]/g, "_"),
          "ok",
          `unlinked identity vault ${vu}`
        );
      } else if (vu !== "default") {
        push(
          "accounts.vault." + vu,
          "warn",
          `vault folder ${vu} is not a channel:id identity or account — possible legacy bare id`
        );
      }
    }
  } catch (e) {
    push("accounts", "warn", e.message || String(e));
  }

  // MITM integration (opt-in)
  try {
    const enabled = isMitmEnabled(cfg);
    if (!enabled) {
      push("mitm", "ok", "MITM disabled (default) — set XCLAW_MITM=true or browser.mitm.enabled to enable");
    } else {
      const bin = await findMitmdump();
      if (!bin) {
        push(
          "mitm.binary",
          "error",
          "XCLAW_MITM enabled but mitmdump not found — pip install mitmproxy or set XCLAW_MITMDUMP"
        );
      } else {
        push("mitm.binary", "ok", `mitmdump at ${bin}`);
      }
      const st = await mitmStatus(cfg);
      if (st.listening) {
        push(
          "mitm.proxy",
          "ok",
          `listening :${st.port} ready=${st.ready} ca=${st.caPresent} flows=${st.flowCount} errors=${st.errors ?? 0}`
        );
      } else {
        push(
          "mitm.proxy",
          "warn",
          `enabled but not listening on :${st.port} — start supervisor or mitm_control action=start`
        );
      }
      const ca = await mitmCaStatus(cfg);
      if (!ca.present) {
        push(
          "mitm.ca",
          "warn",
          "mitmproxy CA not found — doctor/agent can run mitm_ca action=ensure; or XCLAW_MITM_INSECURE_CERTS=1 for lab"
        );
      } else if (ca.expired) {
        push("mitm.ca", "error", `CA expired notAfter=${ca.notAfter} path=${ca.certPath}`);
      } else {
        push(
          "mitm.ca",
          "ok",
          `CA ${ca.subject || ""} notAfter=${ca.notAfter || "?"} spki=${(ca.spki || "").slice(0, 16)}…`
        );
      }
    }
  } catch (e) {
    push("mitm", "warn", e.message || String(e));
  }

  // Horizon 0 — production browser organism foundations
  try {
    for (const ch of horizon0Checklist(process.env)) {
      push(
        `h0.${ch.id}`,
        ch.warn ? "warn" : "ok",
        ch.detail
      );
    }
    const sample = buildProductionChromeArgs({
      userDataDir: process.env.XCLAW_BROWSER_PROFILE_DIR || "/tmp/xclaw-h0-doctor",
      headless: true,
    });
    const need = ["--remote-allow-origins=*", "--disable-dev-shm-usage"];
    const missing = need.filter((a) => !sample.includes(a));
    if (missing.length) {
      push("h0.chrome_args", "error", `missing production flags: ${missing.join(", ")}`);
    } else {
      push("h0.chrome_args", "ok", `production flags present (${sample.length} args)`);
    }
  } catch (e) {
    push("h0", "warn", e.message || String(e));
  }


  // A6-ops — Phase A enforcement plane (hooks / fabric / motor / chrome-args)
  try {
    // Resolve against the PACKAGE root first (this file lives at src/cli/), so
    // the installed `xclaw` CLI passes from any cwd; XCLAW_ROOT/cwd stay as
    // overrides for exotic layouts.
    const pkgRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
    const candidates = [process.env.XCLAW_ROOT, pkgRoot, process.cwd()].filter(Boolean);
    const root =
      candidates.find((r) => fsSync.existsSync(path.join(r, "src/computer/hooks-bridge.mjs"))) ||
      candidates[0];
    const bridgeFiles = [
      ["a.hooks_bridge", "src/computer/hooks-bridge.mjs"],
      ["a.motor_bridge", "src/computer/motor-bridge.mjs"],
      ["a.chrome_args_bridge", "src/computer/chrome-args-bridge.mjs"],
      ["a.hooks_module", "src/browser/hooks.mjs"],
      ["a.motor_module", "src/browser/motor.mjs"],
      ["a.chrome_args_module", "src/computer/chrome-args.mjs"],
    ];
    for (const [id, rel] of bridgeFiles) {
      const abs = path.join(root, rel);
      if (fsSync.existsSync(abs)) {
        push(id, "ok", `found ${rel}`);
      } else {
        push(id, "error", `missing ${rel} under XCLAW_ROOT/cwd (${root})`);
      }
    }

    const hooksPath = resolveHooksModulePath();
    if (hooksPath) {
      push("a.hooks_resolve", "ok", `resolveHooksModulePath → ${hooksPath}`);
    } else {
      push("a.hooks_resolve", "error", "hooks.mjs not resolvable — set XCLAW_ROOT");
    }

    const hs = hooksStatus();
    push(
      "a.hooks_status",
      "ok",
      `fabricEnforce=${hs.fabricEnforce} commitGates=${hs.commitGates} truthAuto=${hs.truthAuto}`
    );

    // chrome-args canonical
    try {
      const m = await loadChromeArgsModule();
      if (!m?.buildChromeArgs) {
        push("a.chrome_args_load", "error", "chrome-args module failed to load");
      } else {
        const args = buildChromeArgs({
          userDataDir: process.env.XCLAW_BROWSER_PROFILE_DIR || "/tmp/xclaw-a6-doctor",
          headless: true,
        });
        const inv = chromeArgsInvariants(args);
        if (!inv.ok) {
          push("a.chrome_args_invariants", "error", `missing: ${inv.missing.join(", ")}`);
        } else {
          push("a.chrome_args_invariants", "ok", `canonical argv ok (${args.length} flags)`);
        }
      }
    } catch (e) {
      push("a.chrome_args_load", "error", e.message || String(e));
    }

    // motor load
    try {
      const motor = await loadMotor();
      if (!motor?.planClick) {
        push("a.motor_load", "warn", "motor.mjs not loaded — browser_click humanize unavailable");
      } else {
        const plan = motor.planClick({ x: 10, y: 10, fromX: 0, fromY: 0, targetWidth: 20 });
        push(
          "a.motor_load",
          "ok",
          `planClick steps=${plan.steps?.length || 0} humanize=${plan.meta?.humanize}`
        );
      }
    } catch (e) {
      push("a.motor_load", "warn", e.message || String(e));
    }

    // Behavioral: critic cannot navigate
    try {
      const prevRole = process.env.XCLAW_AGENT_ROLE;
      const denied = await beforeNavigate({
        url: "https://example.com/",
        role: "critic",
        agentId: "doctor",
      });
      if (denied.ok === false && denied.code === "ROLE_NO_NAVIGATE") {
        push("a.role_critic_nav", "ok", "critic navigate denied (ROLE_NO_NAVIGATE)");
      } else {
        push("a.role_critic_nav", "error", `expected ROLE_NO_NAVIGATE, got ${JSON.stringify(denied)}`);
      }
      // actor without gates should pass
      const allowed = await beforeNavigate({
        url: "https://example.com/about",
        role: "actor",
        agentId: "doctor",
      });
      if (allowed.ok) {
        push("a.role_actor_nav", "ok", "actor navigate allowed for non-sensitive URL");
      } else {
        push("a.role_actor_nav", "warn", `actor blocked: ${allowed.code} ${allowed.reason}`);
      }
      if (prevRole === undefined) delete process.env.XCLAW_AGENT_ROLE;
      else process.env.XCLAW_AGENT_ROLE = prevRole;
    } catch (e) {
      push("a.role_check", "warn", e.message || String(e));
    }

    // A7 jsCode + role binding
    try {
      const { assertJsCodeAllowed, jscodeMode } = await import("../browser/jscode-policy.mjs");
      const mode = jscodeMode();
      push("a.jscode_mode", "ok", `mode=${mode}`);
      const blocked = assertJsCodeAllowed("document.querySelector('x').click()");
      if (mode === "allow") {
        push("a.jscode_policy", "ok", "jsCode allow (lab) — motor patterns not blocked");
      } else if (!blocked.ok) {
        push("a.jscode_policy", "ok", `motor-like jsCode blocked (${blocked.code})`);
      } else {
        push("a.jscode_policy", "warn", "expected motor jsCode to be blocked under current mode");
      }
    } catch (e) {
      push("a.jscode_policy", "warn", e.message || String(e));
    }
    try {
      const { resolveRole } = await import("../browser/role-binding.mjs");
      const r = await resolveRole({ sessionId: "doctor-role-probe" });
      push("a.role_binding", "ok", `resolveRole → ${r.role} via ${r.source}`);
    } catch (e) {
      push("a.role_binding", "warn", e.message || String(e));
    }

    // Prod profile expectations
    const isProd =
      process.env.XCLAW_PROFILE === "prod" ||
      cfg.profile === "prod" ||
      process.env.XCLAW_ENFORCEMENT_STRICT === "1";
    if (isProd) {
      const commitGatesOn =
        process.env.XCLAW_COMMIT_GATES === "1" ||
        process.env.XCLAW_COMMIT_GATES === "true" ||
        cfg.security?.commitGates === true;
      if (!commitGatesOn) {
        push("a.prod_commit_gates", "error", "prod profile requires XCLAW_COMMIT_GATES=1 (or security.commitGates)");
      } else {
        push("a.prod_commit_gates", "ok", "commit gates enabled");
      }
      if (!(process.env.XCLAW_FABRIC_ENFORCE === "1" || process.env.XCLAW_FABRIC_ENFORCE === "true")) {
        push("a.prod_fabric", "warn", "prod recommended XCLAW_FABRIC_ENFORCE=1");
      } else {
        push("a.prod_fabric", "ok", "XCLAW_FABRIC_ENFORCE enabled");
      }
    } else {
      push(
        "a.prod_profile",
        "ok",
        "non-prod profile — set XCLAW_ENFORCEMENT_STRICT=1 or profile=prod for hard enforcement checks"
      );
    }

    // Bundle patch markers (A2/A4/A5)
    try {
      const bundle = path.join(root, "src/computer/xclaw-server.mjs");
      if (fsSync.existsSync(bundle)) {
        const head = fsSync.readFileSync(bundle, "utf8");
        const markers = [
          ["a.bundle_navigate_hook", "A2: driver hooks"],
          ["a.bundle_motor", "A4: humanized CDP motor"],
          ["a.bundle_chrome_args", "A5: single Chrome argv"],
        ];
        for (const [id, needle] of markers) {
          if (head.includes(needle)) push(id, "ok", `marker present: ${needle}`);
          else push(id, "error", `bundle missing patch marker: ${needle}`);
        }
      } else {
        // D3: bundle is the product default — missing blob is an error unless
        // the operator explicitly selected native/generated escape hatch.
        let engine = cfg.computer?.engine;
        try {
          const { resolveComputerEngine } = await import("../computer/engine.mjs");
          engine = resolveComputerEngine(cfg);
        } catch {
          engine =
            process.env.XCLAW_COMPUTER_ENGINE ||
            cfg.computer?.engine ||
            "bundle";
        }
        const needsBundle = engine === "bundle" || engine === "full";
        push(
          "a.bundle",
          needsBundle ? "error" : "ok",
          needsBundle
            ? "default engine=bundle but xclaw-server.mjs missing — run: npm run fetch:bundle && npm run verify:bundle"
            : `lightweight engine=${engine}; CDP bundle not required (escape hatch)`
        );
      }
    } catch (e) {
      push("a.bundle", "warn", e.message || String(e));
    }
  } catch (e) {
    push("a.enforcement", "error", e.message || String(e));
  }

  
  // T3 — computer plane is mandatory for bash/files/browser
  try {
    const { COMPUTER_ONLY_TOOLS } = await import("../tools/planes.mjs");
    push(
      "tools.computerOnly",
      "ok",
      `computer-only tools: ${COMPUTER_ONLY_TOOLS.size} (bash/files/browser never in-process)`
    );
  } catch (e) {
    push("tools.computerOnly", "warn", e.message || String(e));
  }

  // ── Providers ── credential + endpoint per configured provider + active model
  try {
    const { providerInventory, checkProviderCredential } = await import("../providers/manage.mjs");
    const inv = await providerInventory(cfg);
    const configured = inv.providers.filter((p) => p.configured);
    push(
      "providers.summary",
      "ok",
      `${configured.length}/${inv.providers.length} configured · active: ${inv.active.provider || "(none)"}/${inv.active.model || "?"}`
    );
    for (const p of configured) {
      const cred = await checkProviderCredential(cfg, p.id);
      const creds = (p.profiles || []).map((x) => (x.id.includes(":") ? x.id.slice(x.id.indexOf(":") + 1) : x.id)).join("+") || (p.hasEnvKey ? "env" : "?");
      if (cred.ok) {
        push(`providers.${p.id}`, "ok", `${p.id}: ${creds} → resolves (${cred.source || "?"}) · ${p.baseUrl}`);
      } else {
        push(`providers.${p.id}`, "warn", `${p.id}: credential does not resolve (${cred.error || "no token"})`);
      }
    }
    // image-gen capability (xai key)
    const xai = await checkProviderCredential(cfg, "xai");
    push("providers.imageGen", xai.ok ? "ok" : "warn",
      xai.ok ? "image generation ready (xai credential resolves)" : "image generation needs an xai credential");

    // Live liveness ping (active provider only — this is what actually
    // serves the bot). Credential *resolving* is not the same as the
    // credential *working*: the 2026-08-13 outage had an anthropic OAuth
    // token that resolved fine (the expiry check was broken) for 9 hours
    // while every real request 401'd, with doctor reporting green the
    // whole time. A forced (uncached), real, authenticated request is the
    // only check that would have caught it — status ERROR so hourly
    // doctor-cron's notifyOnFail actually pages the operator.
    if (inv.active?.provider && cfg.doctor?.providersLiveCheck !== false) {
      try {
        const { fetchLiveModels } = await import("../providers/discovery.mjs");
        const live = await fetchLiveModels(cfg, inv.active.provider, {
          force: true,
          timeoutMs: 8_000,
        });
        if (live.ok) {
          push(
            "providers.liveCheck",
            "ok",
            `${inv.active.provider}: live API call succeeded (${live.count} models)`
          );
        } else {
          push(
            "providers.liveCheck",
            "error",
            `${inv.active.provider}: live API call failed — ${live.error || "unknown error"}`
          );
        }
      } catch (e) {
        push(
          "providers.liveCheck",
          "error",
          `${inv.active.provider}: live check threw — ${e.message || String(e)}`
        );
      }
    }
  } catch (e) {
    push("providers.summary", "warn", e.message || String(e));
  }

  // ── Channels ── enabled/configured + live reachability
  try {
    const { channelInventory } = await import("../channels/manage.mjs");
    const inv = channelInventory(cfg);
    const enabled = inv.channels.filter((c) => c.enabled);
    push("channels.summary", "ok", `${enabled.length}/${inv.channels.length} enabled: ${enabled.map((c) => c.id).join(", ") || "(none)"}`);
    for (const c of inv.channels) {
      if (!c.enabled && !c.fields.some((f) => f.set)) continue; // skip untouched channels
      const setFields = c.fields.filter((f) => f.set).map((f) => f.key).join(",");
      const state = c.enabled ? (c.configured ? "enabled+ready" : "enabled but MISSING required config") : "configured (disabled)";
      push(`channels.${c.id}`, c.enabled && !c.configured ? "warn" : "ok", `${c.id}: ${state}${setFields ? " · " + setFields : ""}`);
    }
    // live telegram bot reachability (if a token is configured)
    const tgToken = cfg.channels?.telegram?.token;
    if (tgToken) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${tgToken}/getMe`, { signal: AbortSignal.timeout(8000) });
        const j = await res.json();
        push("channels.telegram.api", j.ok ? "ok" : "warn",
          j.ok ? `bot @${j.result.username} reachable (id ${j.result.id})` : `getMe failed: ${j.description || res.status}`);
      } catch (e) {
        push("channels.telegram.api", "warn", `telegram API unreachable: ${e.message}`);
      }
    }
  } catch (e) {
    push("channels.summary", "warn", e.message || String(e));
  }

  // ── Services ── pm2-managed gateway (the running bot)
  try {
    // Only query pm2 if its daemon is already running: the pm2 client
    // auto-spawns a God Daemon under $PM2_HOME (default $HOME/.pm2) when
    // none exists, and that daemon outlives us. Under test/temp HOMEs this
    // leaked one immortal ~25MB daemon per doctor run (612 daemons / 13.6GB
    // on 2026-08-14). A doctor must never mutate the host it examines.
    const pm2Home = process.env.PM2_HOME || path.join(os.homedir(), ".pm2");
    const pm2DaemonUp = await fs
      .stat(path.join(pm2Home, "rpc.sock"))
      .then((s) => s.isSocket())
      .catch(() => false);
    const { execFile } = await import("node:child_process");
    const pm2 = !pm2DaemonUp ? null : await new Promise((resolve) => {
      execFile("pm2", ["jlist"], { timeout: 6000 }, (err, out) => {
        if (err) return resolve(null);
        try { resolve(JSON.parse(out)); } catch { resolve(null); }
      });
    });
    if (pm2) {
      const gw = pm2.find((p) => p.name === "xclaw-gateway");
      if (gw) {
        const st = gw.pm2_env?.status;
        push("service.gateway", st === "online" ? "ok" : "warn",
          `pm2 xclaw-gateway: ${st} (restarts=${gw.pm2_env?.restart_time ?? "?"}, uptime=${gw.pm2_env?.pm_uptime ? Math.round((Date.now() - gw.pm2_env.pm_uptime) / 1000) + "s" : "?"})`);
      } else {
        push("service.gateway", "ok", "no pm2 xclaw-gateway (run under pm2 for a persistent bot)");
      }
    }
  } catch {
    /* pm2 optional */
  }


  // CUA / computer-use readiness (CDP + desktop drivers + retry metrics)
  try {
    const { runCuaDoctor } = await import("../computer/cua-doctor.mjs");
    const cua = await runCuaDoctor(process.env);
    for (const c of cua.checks || []) {
      const status =
        c.severity === "error" ? "error" : c.severity === "warn" ? "warn" : "ok";
      const msg = c.hint ? `${c.message} — ${c.hint.split("\n")[0]}` : c.message;
      push(`cua.${c.id}`, status, msg, {
        surface: "cua",
        recovery: c.hint || null,
        retryMetrics: c.id === "cua_retry_metrics" ? cua.retryMetrics : undefined,
      });
    }
    if (cua.retryMetrics && (cua.retryMetrics.retries > 0 || cua.retryMetrics.attempts > 1)) {
      push(
        "cua.retry.summary",
        cua.retryMetrics.retries > 50 ? "warn" : "ok",
        `retry attempts=${cua.retryMetrics.attempts} retries=${cua.retryMetrics.retries} successRate=${cua.retryMetrics.successRate ?? "n/a"}`
      );
    }
  } catch (e) {
    push("cua.doctor", "warn", e?.message || String(e));
  }

  return finish(checks, opts);


}

/** Map check id → display group */
function doctorGroup(id) {
  const s = String(id || "");
  if (
    s.startsWith("config") ||
    s.startsWith("profile") ||
    s === "node" ||
    s.startsWith("paths")
  )
    return "Config";
  if (
    s.startsWith("security") ||
    s.startsWith("owner") ||
    s.startsWith("auth") ||
    s.startsWith("sandbox") ||
    s.startsWith("egress")
  )
    return "Security";
  if (
    s.startsWith("computer") ||
    s.startsWith("browser") ||
    s.startsWith("chrome") ||
    s.startsWith("mitm") ||
    s.startsWith("hooks") ||
    s.startsWith("motor") ||
    s.startsWith("a.")
  )
    return "Computer";
  if (s.startsWith("providers")) return "Providers";
  if (s.startsWith("channels") || s.startsWith("service")) return "Channels";
  if (
    s.startsWith("gateway") ||
    s.startsWith("bind") ||
    s.startsWith("retry") ||
    s.startsWith("apiKey") ||
    s.startsWith("swarm") ||
    s.startsWith("git") ||
    s.startsWith("ssh")
  )
    return "Runtime";
  return "Other";
}

function finish(checks, opts) {
  const errors = checks.filter((c) => c.status === "error").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const exitCode = errors ? 2 : warns ? 1 : 0;
  const grouped = {};
  for (const c of checks) {
    const g = doctorGroup(c.id);
    (grouped[g] ||= []).push(c);
  }
  const report = {
    ok: errors === 0,
    exitCode,
    /** 0 = clean, 1 = warnings only, 2 = errors */
    exitCodeMeaning: {
      0: "ok",
      1: "warnings_only",
      2: "errors",
    },
    errors,
    warnings: warns,
    groups: grouped,
    checks,
    at: new Date().toISOString(),
  };
  if (!opts.quiet) {
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log("XClaw doctor\n");
      const order = ["Config", "Security", "Providers", "Channels", "Computer", "Runtime", "Other"];
      for (const g of order) {
        const list = grouped[g];
        if (!list?.length) continue;
        console.log(`── ${g} ──`);
        for (const c of list) {
          const tag =
            c.status === "ok" ? "OK  " : c.status === "warn" ? "WARN" : "ERR ";
          console.log(`  [${tag}] ${c.id}: ${c.message}`);
        }
        console.log("");
      }
      console.log(
        `Summary: ${errors} error(s), ${warns} warning(s) — exit ${exitCode}`
      );
      console.log(
        "Exit codes: 0 = ok · 1 = warnings only · 2 = errors"
      );
    }
  }
  return report;
}

export async function doctorMain(args = []) {
  const json = args.includes("--json");
  const report = await runDoctor({ json });
  process.exitCode = report.exitCode;
  return report;
}
