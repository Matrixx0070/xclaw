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
import {
  buildSystemRunPlan,
  revalidatePlan,
  isExecTool,
} from "./system-run-plan.mjs";

const pending = new Map(); // id -> { tool, args, plan, resolve, at, deadline }
let slaTimer = null;
let sharedGate = null;

function ensureSlaTimer(cfg) {
  if (slaTimer) return;
  const tickMs = cfg?.security?.approvalSlaTickMs ?? 5_000;
  slaTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, item] of [...pending.entries()]) {
      if (item.deadline && now >= item.deadline) {
        pending.delete(id);
        const action = item.slaAction || "deny";
        if (action === "deny") {
          item.resolve({
            ok: false,
            reason: "sla_timeout",
            message: `Approval SLA exceeded for ${item.tool}`,
            planFingerprint: item.plan?.fingerprint ?? null,
          });
        } else {
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
    (security.requireApproval || ["xclaw_bash", "bash", "shell"]).map(normalizeToolName)
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
      (security.execTools || ["xclaw_bash", "bash", "shell", "exec"]).map(normalizeToolName)
    );
    if (!execTools.has(normalizeToolName(name))) return true;
    const cmd =
      args?.command ?? args?.cmd ?? args?.script ?? args?.input ?? "";
    return commandMatchesExecAllowlist(String(cmd), patterns, {
      cwd: args?.cwd || args?.workingDir,
    });
  }

  function needsApproval(name) {
    const n = normalizeToolName(name);
    if (autoApprove) return false;
    if (policy === "never") return false;
    if (safeAuto.has(n)) return false;
    if (policy === "always") return true;
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
   * @returns {Promise<{ok, approved?, reason?, message?, mode?, pendingId?, plan?, planFingerprint?}>}
   */
  async function authorize(name, args, { timeoutMs = 120_000, onPending } = {}) {
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
    if (!needsApproval(name)) {
      // Auto path: still optionally bind a plan for downstream audit, but do not block.
      let plan = null;
      if (bindSystemRunPlan && isExecTool(name)) {
        const bound = tryBindPlan(name, args);
        if (bound.ok) plan = bound.plan;
        // Soft on auto path — never fail closed for unboundable exe unless caller forced it.
      }
      return {
        ok: true,
        approved: true,
        mode: "auto",
        plan: sanitizePlan(plan),
        planFingerprint: plan?.fingerprint ?? null,
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

    const id = `apr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const slaMs = security.approvalSlaMs ?? timeoutMs;
    const slaAction = security.approvalSlaAction || "deny"; // deny | approve
    ensureSlaTimer({ security });
    const wait = new Promise((resolve) => {
      pending.set(id, {
        id,
        tool: name,
        args,
        plan,
        at: new Date().toISOString(),
        atMs: Date.now(),
        deadline: Date.now() + slaMs,
        slaAction,
        resolve,
      });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve({
            ok: false,
            reason: "timeout",
            message: `Approval timed out for ${name}.`,
            planFingerprint: plan?.fingerprint ?? null,
          });
        }
      }, timeoutMs);
    });

    onPending?.({
      id,
      tool: name,
      args,
      plan: sanitizePlan(plan),
      planFingerprint: plan?.fingerprint ?? null,
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
      pending.set(id, {
        id,
        tool: name,
        args,
        at: new Date().toISOString(),
        resolve,
      });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve({ ok: false, reason: "timeout", message: "Approval timed out." });
        }
      }, opts.timeoutMs ?? 120_000);
    });
    return { ok: false, pending: true, pendingId: id, wait };
  }

  function decide(pendingId, approved, note = "") {
    const item = pending.get(pendingId);
    if (!item) return { ok: false, error: "unknown_pending" };
    pending.delete(pendingId);

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
      at: item.at,
      ageMs: item.atMs ? now - item.atMs : null,
      deadline: item.deadline ? new Date(item.deadline).toISOString() : null,
      remainingMs: item.deadline ? Math.max(0, item.deadline - now) : null,
      slaAction: item.slaAction || "deny",
      plan: sanitizePlan(item.plan),
      planFingerprint: item.plan?.fingerprint ?? null,
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
  };
}

/** Process-wide shared gate (gateway + agent loop). */
export function getSharedApprovalGate(cfg = {}) {
  if (!sharedGate) sharedGate = createApprovalGate(cfg);
  return sharedGate;
}

/** Reset shared gate (tests / config reload). */
export function resetSharedApprovalGate(cfg = {}) {
  sharedGate = createApprovalGate(cfg);
  return sharedGate;
}
