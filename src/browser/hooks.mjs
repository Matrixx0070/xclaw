/**
 * Phase A2 — Driver hooks (enforcement plane)
 *
 * Called from the computer actuation path (and optionally the gateway belt).
 * Fail-closed when env says so; never throws into a bare crash — returns
 * { ok:false, code, reason } so the driver can surface a tool error.
 *
 * Hooks:
 *   buildChromeArgs(baseArgs, ctx) → string[]
 *   beforeNavigate(ctx)            → { ok, code?, reason?, gate? }
 *   beforeInput(ctx)               → { ok, code?, reason? }
 *   afterAction(ctx, result)       → { ok, metadata? }
 */

import { horizon0Checklist } from "./horizon0.mjs";
import {
  requireTabLease,
  requireCommitGate,
  assertMotorAllowed,
  isCommitSensitive,
} from "./physics.mjs";
import {
  createActionId,
  networkCursor,
  networkDeltaSince,
  bindActionFlows,
} from "./sense.mjs";
import { afterBrowserToolTruth } from "./truth.mjs";
import { resolveRole } from "./role-binding.mjs";
import { assertJsCodeAllowed } from "./jscode-policy.mjs";
import { touchLease, startLeaseHeartbeat } from "./lease-heartbeat.mjs";

function truthAuto() {
  return (
    process.env.XCLAW_TRUTH_AUTO_ASSERT === "1" ||
    process.env.XCLAW_TRUTH_AUTO_ASSERT === "true"
  );
}

function commitGatesOn() {
  return (
    process.env.XCLAW_COMMIT_GATES === "1" ||
    process.env.XCLAW_COMMIT_GATES === "true"
  );
}

function fabricEnforce() {
  return (
    process.env.XCLAW_FABRIC_ENFORCE === "1" ||
    process.env.XCLAW_FABRIC_ENFORCE === "true" ||
    commitGatesOn()
  );
}

function agentIdFrom(ctx = {}) {
  return (
    ctx.agentId ||
    process.env.XCLAW_AGENT_ID ||
    ctx.sessionId ||
    `agent_${process.pid}`
  );
}

async function roleFrom(ctx = {}) {
  const r = await resolveRole(ctx);
  return r.role;
}

/**
 * Merge production flags into Chrome argv (dedupe by flag prefix where safe).
 * @param {string[]} baseArgs
 * @param {object} [ctx]
 */
/** Launch argv canonical builder is src/computer/chrome-args.mjs (A5). This merges H0 invariants into existing lists. */
export async function buildChromeArgs(baseArgs = [], ctx = {}) {
  const out = Array.isArray(baseArgs) ? [...baseArgs] : [];
  const must = [
    "--remote-allow-origins=*",
    "--disable-dev-shm-usage",
    "--disable-crash-reporter",
  ];
  for (const m of must) {
    if (!out.includes(m)) out.push(m);
  }
  // Prefer headless=new over legacy --headless when present
  const hi = out.findIndex((a) => a === "--headless" || a.startsWith("--headless="));
  if (hi >= 0 && out[hi] === "--headless") out[hi] = "--headless=new";
  if (ctx.extra && Array.isArray(ctx.extra)) {
    for (const a of ctx.extra) {
      if (a && !out.includes(a)) out.push(a);
    }
  }
  return out;
}

/**
 * @param {{ url?: string, tabId?: string, agentId?: string, role?: string, action?: string }} ctx
 */
export async function beforeNavigate(ctx = {}) {
  const url = ctx.url || "";
  const tabId = ctx.tabId;
  const agentId = agentIdFrom(ctx);
  const role = await roleFrom(ctx);

  const motor = assertMotorAllowed(role, "navigate");
  if (!motor.ok) {
    return { ok: false, code: motor.code, reason: motor.reason, phase: "beforeNavigate" };
  }

  if (fabricEnforce() && tabId) {
    const lease = await requireTabLease(tabId, {
      agentId,
      role,
      action: "navigate",
      autoAcquire: process.env.XCLAW_TAB_LEASE_AUTO === "1",
    });
    if (!lease.ok) {
      return {
        ok: false,
        code: lease.code || "TAB_LEASE_REQUIRED",
        reason: lease.reason,
        phase: "beforeNavigate",
        holder: lease.holder,
      };
    }
  }

  if (commitGatesOn() && url && isCommitSensitive(url)) {
    const gate = await requireCommitGate(url, {
      tabId,
      agentId,
      action: "navigate",
      forceCheck: true,
    });
    if (!gate.ok) {
      return {
        ok: false,
        code: gate.code || "COMMIT_GATE_REQUIRED",
        reason: gate.reason,
        phase: "beforeNavigate",
        gate: gate.gate,
        sensitive: true,
      };
    }
  }

  const actionId = createActionId("navigate");
  const cursor = networkCursor();
  if (tabId && fabricEnforce()) {
    try {
      await touchLease(tabId, { agentId });
      startLeaseHeartbeat(tabId, { agentId });
    } catch {
      /* non-fatal */
    }
  }
  return {
    ok: true,
    phase: "beforeNavigate",
    actionId,
    cursor,
    agentId,
    role,
  };
}

/**
 * @param {{ tabId?: string, agentId?: string, role?: string, action?: string, kind?: string }} ctx
 */
export async function beforeInput(ctx = {}) {
  const agentId = agentIdFrom(ctx);
  const role = await roleFrom(ctx);
  const action = ctx.action || ctx.kind || "motor";

  // A7: jsCode motor patterns blocked under enforce
  if (ctx.jsCode) {
    const js = assertJsCodeAllowed(ctx.jsCode);
    if (!js.ok) {
      return { ok: false, code: js.code, reason: js.reason, phase: "beforeInput", mode: js.mode };
    }
  }

  // Observe/screenshot: read path — observer + critic allowed
  const readOnly = action === "observe" || action === "screenshot" || action === "read";
  if (!readOnly) {
    const motor = assertMotorAllowed(
      role,
      action === "navigate" ? "navigate" : "motor"
    );
    if (!motor.ok) {
      return { ok: false, code: motor.code, reason: motor.reason, phase: "beforeInput" };
    }
  }

  // A3: fabric enforce requires lease on existing tabId (auto-acquire optional)
  if (fabricEnforce() && ctx.tabId) {
    const auto =
      process.env.XCLAW_TAB_LEASE_AUTO === "1" ||
      process.env.XCLAW_TAB_LEASE_AUTO === "true";
    const lease = await requireTabLease(ctx.tabId, {
      agentId,
      role,
      action,
      autoAcquire: auto,
    });
    if (!lease.ok) {
      return {
        ok: false,
        code: lease.code || "TAB_LEASE_REQUIRED",
        reason: lease.reason,
        phase: "beforeInput",
        holder: lease.holder,
      };
    }
  }

  const actionId = createActionId(action || "input");
  const cursor = networkCursor();
  if (ctx.tabId && fabricEnforce()) {
    try {
      await touchLease(ctx.tabId, { agentId });
      startLeaseHeartbeat(ctx.tabId, { agentId });
    } catch {
      /* non-fatal */
    }
  }
  return { ok: true, phase: "beforeInput", actionId, cursor, agentId, role };
}

/**
 * @param {object} ctx — should include actionId/cursor from before*
 * @param {object} [result]
 */
export async function afterAction(ctx = {}, result = {}) {
  const actionId = ctx.actionId || createActionId("action");
  const cursor = ctx.cursor || networkCursor();
  let delta = { enabled: false, flows: [], count: 0 };
  try {
    delta = await networkDeltaSince(cursor, { limit: 50 });
    await bindActionFlows(actionId, delta.flows || [], {
      label: ctx.label || ctx.action || "action",
      tabId: ctx.tabId,
    });
  } catch {
    /* binding must not break actuation */
  }

  let truth = null;
  if (truthAuto()) {
    try {
      truth = await afterBrowserToolTruth(ctx.toolName || "browser_act", {
        metadata: { actionId, network: { flows: delta.flows } },
      });
    } catch {
      /* */
    }
  }

  return {
    ok: true,
    phase: "afterAction",
    actionId,
    network: {
      enabled: delta.enabled,
      flowCount: delta.count,
      flows: (delta.flows || []).slice(0, 15),
    },
    truth,
  };
}

/**
 * Resolve hooks module from computer process (absolute or relative to XCLAW_ROOT).
 */
export function hooksStatus() {
  return {
    fabricEnforce: fabricEnforce(),
    commitGates: commitGatesOn(),
    truthAuto: truthAuto(),
    tabLeaseAuto: process.env.XCLAW_TAB_LEASE_AUTO === "1",
    checklist: horizon0Checklist?.() || null,
  };
}

export default {
  buildChromeArgs,
  beforeNavigate,
  beforeInput,
  afterAction,
  hooksStatus,
};
