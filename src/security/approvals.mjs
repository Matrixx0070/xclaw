/**
 * Exec approvals & tool allowlists (parity gap #6).
 * Module holds a shared gate so gateway decide API and agent loop see the same pending map.
 *
 * systemRunPlan binding (OpenClaw-aligned):
 * - For tools that require human/SLA approval, freeze argv/cwd/exe (+ optional file hashes)
 *   before the decision is recorded.
 * - On approve, revalidate pins to close classic TOCTOU windows.
 * - Fail-closed only when security.requirePinnedExe is true and the executable cannot be realpath'd.
 */
import {
  isToolNameAllowlisted,
  normalizeToolName,
} from "./tool-allowlist-guard.mjs";
import { commandMatchesExecAllowlist } from "./exec-allowlist-pattern.mjs";
import { getSharedLedger } from "../ops/ledger.mjs";
import { assessRisk, tierRank } from "./risk.mjs";
import { matchDecision, addDecision } from "./decisions.mjs";
import {
  buildSystemRunPlan,
  revalidatePlan,
  EXEC_TOOLS,
  isExecTool,
} from "./system-run-plan.mjs";
import { authorizeQuotaPreflight } from "./authorize-quota.mjs";

const pending = new Map(); // id -> { tool, args, plan, resolve, at, deadline }
let slaTimer = null;
let sharedGate = null;
let sharedGateSecurityKey = null;

/**
 * The reasons that mean "the approval window closed and NOBODY answered":
 * the 120s fallback timer plus both SLA expiries. The ask stays open, so the
 * caller must stop and wait rather than treat the answer as a verdict.
 *
 * Enumerated, not pattern-matched. Callers used to sniff for the substring
 * "timeout", which would misread any future verdict reason that happens to
 * contain it (say `exec_timeout_policy`) as "still pending" — the same class of
 * bug as keying on pendingId. Add new unanswered-window reasons HERE.
 */
export const UNANSWERED_APPROVAL_REASONS = Object.freeze(
  new Set(["pending", "timeout", "sla_timeout", "sla_timeout_critical"])
);

/**
 * Stamp `awaitingHuman` on an answer leaving the gate.
 *
 * authorize AWAITS the pending promise, so every result it returns is already a
 * resolution — there is no "still deciding" state to observe from outside. What
 * a caller actually needs to know is whether a human ANSWERED: an unanswered
 * window leaves the ask open (stop the turn and wait), while a verdict — deny,
 * drift, policy block — is final and the turn continues with the denial.
 *
 * Read this field. Never infer pendency from `pendingId`: authorize stamps that
 * id onto every human-path answer, verdicts included, which is exactly how
 * every operator Deny was once misread as "still pending" (3.180.0).
 * @template {object} T
 * @param {T} res
 * @returns {T & {awaitingHuman: boolean}}
 */
function stampAwaitingHuman(res) {
  if (!res || typeof res !== "object") return res;
  const unanswered =
    res.pending === true ||
    (res.ok === false && UNANSWERED_APPROVAL_REASONS.has(res.reason));
  return { ...res, awaitingHuman: unanswered };
}

function ensureSlaTimer(cfg) {
  if (slaTimer) return;
  const tickMs = cfg?.security?.approvalSlaTickMs ?? 5_000;
  slaTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, item] of [...pending.entries()]) {
      if (item.deadline && now >= item.deadline) {
        pending.delete(id);
        // Field is timeoutHandle (not .timer) — the uncleaned 120s fallback
        // timer held child processes/tests alive after SLA resolution
        // (event-loop-drain bug class).
        if (item.timeoutHandle) clearTimeout(item.timeoutHandle);
        const action = item.slaAction || "deny";
        journalDecision(cfg, {
          tool: item.tool,
          decision: action === "deny" ? "deny" : "approve",
          mode: "sla",
          pendingId: id,
          planFingerprint: item.plan?.fingerprint ?? null,
        }, "sla");
        if (action === "deny") {
          item.resolve({
            ok: false,
            reason: "sla_timeout",
            message: `Approval SLA exceeded for ${item.tool}`,
            planFingerprint: item.plan?.fingerprint ?? null,
          });
        } else {
          // SLA auto-approve is still an approval — run the same TOCTOU
          // revalidation as a human decide (brief 1.2: deny at resolve when
          // the pinned environment drifted while the request sat pending).
          if (item.plan && (cfg?.security?.revalidateOnDecide !== false)) {
            const check = revalidatePlan(item.plan);
            if (!check.ok) {
              item.resolve({
                ok: false,
                reason: check.reason || "plan_drift",
                message:
                  check.message ||
                  "Execution environment drifted before SLA auto-approve (TOCTOU).",
                drift: check.drift || null,
                planFingerprint: item.plan?.fingerprint ?? null,
              });
              continue;
            }
          }
          item.resolve({
            ok: true,
            approved: true,
            mode: "sla_auto",
            note: "SLA auto-approve",
            planFingerprint: item.plan?.fingerprint ?? null,
          });
        }
      }
    }
  }, tickMs);
  if (slaTimer.unref) slaTimer.unref();
}

// A1 ledger: every human/SLA approval resolution is journaled durably.
// Best-effort — journaling must never affect the decision path.
function journalDecision(cfg, data, actor = "operator") {
  try {
    getSharedLedger(cfg || {}).append({ kind: "policy", actor, data });
  } catch {
    /* never blocks approvals */
  }
}

function sanitizePlan(plan) {
  if (!plan) return null;
  return {
    version: plan.version,
    tool: plan.tool,
    isExec: plan.isExec,
    command: plan.command,
    argv: plan.argv ? [...plan.argv] : [],
    cwd: plan.cwd,
    exe: plan.exe,
    fingerprint: plan.fingerprint,
    fileOperandCount: (plan.fileOperands || []).length,
    createdAt: plan.createdAt,
  };
}

export function createApprovalGate(cfg = {}) {
  const security = cfg.security || {};
  const allowlist = new Set(security.allowedTools || []);
  const requireApproval = new Set(
    (security.requireApproval || [...EXEC_TOOLS]).map(normalizeToolName)
  );
  const safeAuto = new Set(
    (security.safeAuto || [
      "xclaw_file_read",
      "file_read",
      "read_file",
      "xclaw_file_list",
      "list_dir",
    ]).map(normalizeToolName)
  );
  const autoApprove = security.autoApprove === true;
  /** always | risky | never — when not full autoApprove */
  const policy = security.approvalPolicy || "risky";
  /**
   * A2 risk-bounded autonomy: when set (e.g. "risky"), tiers ≤ maxTier run
   * without asking and higher tiers pend — replacing blanket autoApprove with
   * a bounded privilege. safeAuto still wins below; requireApproval lists
   * apply only to the legacy policy path.
   */
  const autoApproveMaxTier = security.autoApproveMaxTier || null;
  /**
   * What "critical" does to blanket autoApprove: "ask" (default) escalates,
   * "deny" refuses, "legacy" preserves pre-A2 behavior.
   * SCAFFOLD: "legacy" exists for one release as a migration escape hatch.
   */
  const criticalOverride = security.criticalOverride || "ask";

  /** Bind frozen systemRunPlan for tools that enter the approval path. Default on. */
  const bindSystemRunPlan = security.bindSystemRunPlan !== false;
  const hashFileOperands = security.hashFileOperands === true;
  const requirePinnedExe = security.requirePinnedExe === true;
  /** Re-check pins on human/SLA approve. Default on. */
  const revalidateOnDecide = security.revalidateOnDecide !== false;
  const planRoot = security.planRoot || process.cwd();

  function isToolAllowed(name) {
    if (!allowlist.size) return true;
    return isToolNameAllowlisted(name, [...allowlist]);
  }

  function isExecCommandAllowed(name, args) {
    const patterns = security.execAllowlist || security.execPatterns || [];
    if (!patterns.length) return true;
    const execTools = new Set(
      (security.execTools || [...EXEC_TOOLS]).map(normalizeToolName)
    );
    if (!execTools.has(normalizeToolName(name))) return true;
    const cmd =
      args?.command ?? args?.cmd ?? args?.script ?? args?.input ?? "";
    return commandMatchesExecAllowlist(String(cmd), patterns, {
      cwd: args?.cwd || args?.workingDir,
    });
  }

  /**
   * name-based decision + A2 risk tier. risk is optional for backwards
   * compatibility (external callers); without it, behavior is pre-A2.
   */
  /**
   * Owner-granted bounded trust window: temporarily raises the auto-approve
   * ceiling (never past "risky" — critical ALWAYS pends). Built for the
   * live-observed approval storm: 52 manual inline-button approvals in 30
   * minutes during one audit session; per-command pins can't help when every
   * command differs. In-memory only — a gateway restart clears it, which is
   * the safe failure mode.
   */
  let trustWindow = null; // { maxTier, expiresAt, by }

  function setTrustWindow({ maxTier = "risky", ttlMs, by = "operator" } = {}) {
    const ttl = Math.min(Math.max(Number(ttlMs) || 0, 60_000), 4 * 3600_000); // 1min..4h
    const tier = tierRank(maxTier) >= tierRank("risky") ? "risky" : maxTier; // hard ceiling
    trustWindow = { maxTier: tier, expiresAt: Date.now() + ttl, by };
    journalDecision(cfg, { decision: "trust_window_set", maxTier: tier, ttlMs: ttl, by }, by);
    return { ...trustWindow };
  }

  function clearTrustWindow(by = "operator") {
    const had = Boolean(activeTrustWindow());
    trustWindow = null;
    if (had) journalDecision(cfg, { decision: "trust_window_cleared", by }, by);
    return { cleared: had };
  }

  function activeTrustWindow() {
    if (!trustWindow) return null;
    if (Date.now() >= trustWindow.expiresAt) {
      trustWindow = null;
      return null;
    }
    return { ...trustWindow };
  }

  function needsApproval(name, risk = null, { ignoreBypass = false } = {}) {
    const n = normalizeToolName(name);
    const critical = risk?.tier === "critical";
    // Full autonomy, the equivalent of Claude Code's bypassPermissions: nothing
    // is ever asked, at any risk tier. Off by default and deliberately its own
    // flag rather than a tier setting, because it is not a bound — it removes
    // the gate. The gateway logs it at boot and doctor reports it, so a machine
    // running this way says so out loud.
    // ignoreBypass: a session overlay (TUI Shift+Tab "auto") can drop bypass
    // for one run without rewriting the machine flag. Overlay never loosens.
    // Trust Sprint (2026-08-23): bypass no longer covers CRITICAL actions —
    // the same deliberate change A2 made for blanket autoApprove. A machine
    // running with the gate removed still pends the most dangerous class
    // (rm -rf /, force-push, credential writes). criticalOverride:"legacy"
    // restores the pre-3.155 full bypass explicitly.
    if (security.bypassApprovals === true && !ignoreBypass) {
      return critical && criticalOverride !== "legacy";
    }
    if (autoApprove) {
      // Blanket autoApprove no longer covers critical actions — the one
      // deliberate behavior change of A2 (criticalOverride:"legacy" reverts).
      return critical && criticalOverride !== "legacy";
    }
    const trust = activeTrustWindow();
    const effectiveMaxTier =
      trust && (!autoApproveMaxTier || tierRank(trust.maxTier) > tierRank(autoApproveMaxTier))
        ? trust.maxTier
        : autoApproveMaxTier;
    if (effectiveMaxTier && risk) {
      if (safeAuto.has(n)) return false;
      // M5: critical actions still honor criticalOverride even when the
      // configured max tier is "critical" — a max of "critical" must not be a
      // silent blanket auto-approve for the most dangerous class.
      if (critical && criticalOverride !== "legacy") return true;
      return tierRank(risk.tier) > tierRank(effectiveMaxTier);
    }
    if (policy === "never") return false;
    if (safeAuto.has(n)) return false;
    // Novel danger the requireApproval list never anticipated still asks.
    if (critical) return true;
    if (policy === "always") return true;
    // MCP tools (mcp__<server>__<tool>) are third-party code the operator
    // never vetted tool-by-tool — risky by default. Before this rule, the
    // "risky" policy only matched the requireApproval list (bash/file_write
    // names), so EVERY MCP tool auto-ran unapproved (2026-08-13 audit).
    // Operators opt specific tools out via security.safeAuto, or all of them
    // via security.mcpAutoApprove: true.
    if (n.startsWith("mcp__")) return security.mcpAutoApprove !== true;
    // risky (default): only listed tools
    return requireApproval.has(n) || requireApproval.has(name);
  }

  /**
   * Build a frozen plan when binding is enabled.
   * Returns { ok, plan?, reason?, message? }.
   */
  function tryBindPlan(name, args) {
    if (!bindSystemRunPlan) return { ok: true, plan: null };
    // Prefer explicit tool cwd / workingDir so subagent workspaces pin correctly
    const root =
      (args && (args.cwd || args.workingDir || args.workdir)) ||
      planRoot;
    const built = buildSystemRunPlan({
      tool: name,
      args: {
        ...args,
        requirePinnedExe: requirePinnedExe || args?.requirePinnedExe,
      },
      root,
      hashFileOperands,
    });
    return built;
  }

  /**
   * Authorize a tool call, awaiting a human when policy requires one.
   *
   * Every answer carries `awaitingHuman`, stamped at this one boundary so no
   * caller has to guess pendency from a reason string or an id. See
   * stampAwaitingHuman.
   * @returns {Promise<{ok, awaitingHuman: boolean, approved?, reason?, message?, mode?, pendingId?, plan?, planFingerprint?}>}
   */
  async function authorize(name, args, opts = {}) {
    return stampAwaitingHuman(await authorizeInner(name, args, opts));
  }

  async function authorizeInner(name, args, { timeoutMs = 120_000, onPending, forceHuman = false, ignoreBypass = false, riskWorkingDir = null, job = null } = {}) {
    if (!isToolAllowed(name)) {
      return {
        ok: false,
        reason: "not_allowlisted",
        message: `Tool ${name} is not on the allowlist.`,
      };
    }
    if (!isExecCommandAllowed(name, args)) {
      return {
        ok: false,
        reason: "exec_not_allowlisted",
        message: `Command for ${name} is not on the exec allowlist.`,
      };
    }
    try {
      const q = await authorizeQuotaPreflight(name, args, {
        cfg,
        workingDir: riskWorkingDir || args?.cwd || args?.workingDir || planRoot,
        job,
        hubs: cfg?._hubs || {},
      });
      if (q && q.ok === false) {
        return {
          ok: false,
          reason: q.reason || "WORKSPACE_QUOTA_EXCEEDED",
          message: q.message || "workspace quota exceeded",
          quota: q.quota || null,
          escalatedFromSoft: Boolean(q.escalatedFromSoft),
        };
      }
    } catch {
      /* quota optional */
    }
    // A2: deterministic risk assessment for every action. Never throws —
    // assessment failure degrades to null (pre-A2 behavior), not to a block.
    let risk = null;
    try {
      risk = assessRisk({
        tool: name,
        args,
        // riskWorkingDir: the RUN's workspace (session dir / mission
        // worktree), passed by the loop. Without it, non-exec tools fell back
        // to the gateway's planRoot and every path scoped against the wrong
        // root (live blind spot: home writes scored "workspace").
        workingDir: riskWorkingDir || args?.cwd || args?.workingDir || planRoot,
        cfg,
        context: security.riskContext || {},
      });
    } catch {
      risk = null;
    }

    if (risk?.tier === "critical" && criticalOverride === "deny" && !autoApprove) {
      journalDecision(cfg, {
        tool: name,
        decision: "deny",
        mode: "critical_policy",
        risk,
      }, "agent");
      return {
        ok: false,
        reason: "critical_denied",
        message: `Critical-tier action denied by policy (${(risk.reasons || []).join("; ") || "critical risk"}).`,
        risk,
      };
    }

    // forceHuman: a pre_tool_use hook returned decision:"ask" — escalate to a
    // human even when policy would auto-approve.
    if (!forceHuman && !needsApproval(name, risk, { ignoreBypass })) {
      // Auto path: still optionally bind a plan for downstream audit, but do not block.
      let plan = null;
      if (bindSystemRunPlan && isExecTool(name)) {
        const bound = tryBindPlan(name, args);
        if (bound.ok) plan = bound.plan;
        // Soft on auto path — never fail closed for unboundable exe unless caller forced it.
      }
      // Trust Sprint: bypass mode is no longer invisible to the decision
      // journal. Risky-and-above actions that auto-ran ONLY because
      // bypassApprovals removed the gate leave an audit row (safe/low are
      // not journaled — volume, not signal).
      if (
        security.bypassApprovals === true &&
        !ignoreBypass &&
        risk &&
        tierRank(risk.tier) >= tierRank("risky")
      ) {
        journalDecision(cfg, { tool: name, decision: "approve", mode: "bypass", risk }, "policy");
      }
      return {
        ok: true,
        approved: true,
        mode: "auto",
        plan: sanitizePlan(plan),
        planFingerprint: plan?.fingerprint ?? null,
        risk,
      };
    }

    // Human / SLA path: freeze the plan before the pending record is visible.
    const bound = tryBindPlan(name, args);
    if (!bound.ok) {
      return {
        ok: false,
        reason: bound.reason || "plan_bind_failed",
        message: bound.message || `Failed to bind systemRunPlan for ${name}`,
        plan: sanitizePlan(bound.plan),
      };
    }
    const plan = bound.plan;

    // A2 pinned decisions: a durable "allow-always" covering this exact plan
    // (fingerprint pin) at or below its recorded tier. TOCTOU revalidation
    // still runs downstream — the pin approves the PLAN, not the tool name.
    try {
      const pin = await matchDecision(cfg, { tool: name, plan, tier: risk?.tier });
      if (pin) {
        journalDecision(cfg, {
          tool: name,
          decision: "approve",
          mode: "pinned",
          decisionId: pin.id,
          planFingerprint: plan?.fingerprint ?? null,
          risk,
        }, "operator");
        return {
          ok: true,
          approved: true,
          mode: "pinned",
          decisionId: pin.id,
          plan: sanitizePlan(plan),
          planFingerprint: plan?.fingerprint ?? null,
          risk,
        };
      }
    } catch {
      /* pin lookup must never break the ask path */
    }

    const id = `apr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const slaMs = security.approvalSlaMs ?? timeoutMs;
    const slaAction = security.approvalSlaAction || "deny"; // deny | approve
    ensureSlaTimer({ security });
    const wait = new Promise((resolve) => {
      const entry = {
        id,
        tool: name,
        args,
        plan,
        // why a human is being asked: "policy" (requireApproval list) vs
        // "hook" (a pre_tool_use hook returned decision:"ask")
        origin: forceHuman ? "hook" : "policy",
        risk,
        at: new Date().toISOString(),
        atMs: Date.now(),
        deadline: Date.now() + slaMs,
        slaAction,
        resolve,
        timeoutHandle: null,
      };
      // Tracked so decide()/SLA clear it on resolution — an uncleared 120s
      // timer used to hold the process alive long after the request settled.
      entry.timeoutHandle = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          journalDecision(cfg, {
            tool: name,
            decision: "timeout",
            mode: "timer",
            pendingId: id,
            planFingerprint: plan?.fingerprint ?? null,
          }, "sla");
          resolve({
            ok: false,
            reason: "timeout",
            message: `Approval timed out for ${name}.`,
            planFingerprint: plan?.fingerprint ?? null,
          });
        }
      }, timeoutMs);
      pending.set(id, entry);
    });

    onPending?.({
      id,
      tool: name,
      args,
      plan: sanitizePlan(plan),
      planFingerprint: plan?.fingerprint ?? null,
      risk,
    });
    const decision = await wait;
    return { ...decision, pendingId: id };
  }

  /** @deprecated use authorize */
  async function check(name, args, opts = {}) {
    if (!isToolAllowed(name)) {
      return {
        ok: false,
        reason: "not_allowlisted",
        message: `Tool ${name} is not on the allowlist.`,
      };
    }
    if (!needsApproval(name)) {
      return { ok: true, approved: true, mode: "auto" };
    }
    const id = `apr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const wait = new Promise((resolve) => {
      const entry = {
        id,
        tool: name,
        args,
        at: new Date().toISOString(),
        resolve,
        timeoutHandle: null,
      };
      entry.timeoutHandle = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve({ ok: false, reason: "timeout", message: "Approval timed out." });
        }
      }, opts.timeoutMs ?? 120_000);
      pending.set(id, entry);
    });
    return { ok: false, pending: true, pendingId: id, wait };
  }

  function decide(pendingId, approved, note = "", opts = {}) {
    const item = pending.get(pendingId);
    if (!item) {
      return {
        ok: false,
        code: "APPROVAL_NOT_FOUND",
        error: "unknown_pending",
        message: `No pending approval: ${pendingId}`,
      };
    }
    pending.delete(pendingId);
    if (item.timeoutHandle) {
      try {
        clearTimeout(item.timeoutHandle);
      } catch {
        /* */
      }
      item.timeoutHandle = null;
    }
    journalDecision(cfg, {
      tool: item.tool,
      decision: approved ? "approve" : "deny",
      mode: "human",
      note: note || undefined,
      pendingId,
      planFingerprint: item.plan?.fingerprint ?? null,
      risk: item.risk || undefined,
      allowAlways: opts.allowAlways === true || undefined,
    });
    // A2 durable allow-always: persist a pin so this exact plan (or, with
    // wide:true, this exe+argv0) auto-approves next time — fire-and-forget,
    // the current decision never waits on disk.
    if (approved && opts.allowAlways) {
      addDecision(
        cfg,
        { tool: item.tool, plan: item.plan, tier: item.risk?.tier },
        { wide: opts.wide === true, note: note || null }
      ).catch(() => {});
    }

    if (approved && item.plan && revalidateOnDecide) {
      const check = revalidatePlan(item.plan);
      if (!check.ok) {
        const result = {
          ok: false,
          reason: check.reason || "plan_drift",
          message:
            check.message ||
            "Execution environment drifted after approval (TOCTOU).",
          drift: check.drift || null,
          planFingerprint: item.plan?.fingerprint ?? null,
        };
        item.resolve(result);
        return { ok: true, result };
      }
    }

    const result = approved
      ? {
          ok: true,
          approved: true,
          mode: "human",
          note,
          planFingerprint: item.plan?.fingerprint ?? null,
          plan: sanitizePlan(item.plan),
        }
      : {
          ok: false,
          reason: "denied",
          message: note || "Denied by operator.",
          planFingerprint: item.plan?.fingerprint ?? null,
        };
    item.resolve(result);
    return { ok: true, result };
  }

  function listPending() {
    const now = Date.now();
    return [...pending.values()].map((item) => ({
      id: item.id,
      tool: item.tool,
      args: item.args,
      origin: item.origin || "policy",
      at: item.at,
      ageMs: item.atMs ? now - item.atMs : null,
      deadline: item.deadline ? new Date(item.deadline).toISOString() : null,
      remainingMs: item.deadline ? Math.max(0, item.deadline - now) : null,
      slaAction: item.slaAction || "deny",
      plan: sanitizePlan(item.plan),
      planFingerprint: item.plan?.fingerprint ?? null,
      risk: item.risk || null,
    }));
  }

  function slaStats() {
    const list = listPending();
    return {
      pending: list.length,
      maxAgeMs: list.reduce((m, p) => Math.max(m, p.ageMs || 0), 0),
      slaMs: security.approvalSlaMs ?? null,
      slaAction: security.approvalSlaAction || "deny",
    };
  }

  function policyInfo() {
    return {
      autoApprove,
      approvalPolicy: policy,
      requireApproval: [...requireApproval],
      safeAuto: [...safeAuto],
      pending: pending.size,
      sla: slaStats(),
      systemRunPlan: {
        bind: bindSystemRunPlan,
        hashFileOperands,
        requirePinnedExe,
        revalidateOnDecide,
      },
    };
  }

  return {
    authorize,
    check,
    decide,
    listPending,
    slaStats,
    isToolAllowed,
    needsApproval,
    policyInfo,
    setTrustWindow,
    clearTrustWindow,
    activeTrustWindow,
  };
}

/** Process-wide shared gate (gateway + agent loop). */
export function getSharedApprovalGate(cfg = {}) {
  const key = JSON.stringify(cfg?.security || {});
  if (!sharedGate) {
    sharedGate = createApprovalGate(cfg);
    sharedGateSecurityKey = key;
    return sharedGate;
  }
  // First-caller-wins froze the gate's security policy for the whole process
  // (same singleton-freeze class as getSharedAlerter / the 3.102.1 gate bug):
  // a later caller with DIFFERENT security config silently ran under the
  // stale policy. Upgrade in place when the offered policy is non-empty and
  // differs — but never mid-flight (an in-memory pending must not be
  // stranded) and never downgrade to an empty policy from a bare-{} caller.
  const offersPolicy =
    cfg && cfg.security && Object.keys(cfg.security).length > 0;
  if (offersPolicy && key !== sharedGateSecurityKey) {
    try {
      if ((sharedGate.listPending?.() || []).length === 0) {
        sharedGate = createApprovalGate(cfg);
        sharedGateSecurityKey = key;
      }
    } catch {
      /* keep the existing gate */
    }
  }
  return sharedGate;
}

/** Reset shared gate (tests / config reload). */
export function resetSharedApprovalGate(cfg = {}) {
  sharedGate = createApprovalGate(cfg);
  sharedGateSecurityKey = JSON.stringify(cfg?.security || {});
  return sharedGate;
}


/** Convenience for CLI / doctor */
export function listPendingApprovals(cfg = {}) {
  return getSharedApprovalGate(cfg).listPending();
}

export function decideApproval(cfg, id, approved, note = "") {
  return getSharedApprovalGate(cfg).decide(id, approved, note);
}
