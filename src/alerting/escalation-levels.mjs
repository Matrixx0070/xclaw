/**
 * Customize PagerDuty escalation policy levels from XClaw config.
 *
 * Config shape (alerting.pagerduty.escalation):
 * {
 *   name: "XClaw Primary",
 *   policyId: null,          // if set, update existing; else create
 *   numLoops: 2,
 *   levels: [
 *     { delayMinutes: 0,  targets: [{ type: "user", id: "PXXXX" }] },
 *     { delayMinutes: 15, targets: [{ type: "schedule", id: "PYYYY" }] },
 *     { delayMinutes: 30, targets: [{ type: "user", id: "PZZZZ" }] }
 *   ]
 * }
 */
import {
  getEscalationPolicy,
  listEscalationPolicies,
  createBasicEscalationPolicy,
} from "./pagerduty-rest.mjs";

const PD_API = "https://api.pagerduty.com";

function resolveToken(cfg = {}) {
  return (
    cfg.alerting?.pagerduty?.apiToken ||
    process.env.PAGERDUTY_API_TOKEN ||
    process.env.PD_API_TOKEN ||
    null
  );
}

function headers(token) {
  return {
    Authorization: `Token token=${token}`,
    Accept: "application/vnd.pagerduty+json;version=2",
    "Content-Type": "application/json",
  };
}

/**
 * Normalize levels from config into PD escalation_rules.
 */
export function levelsToRules(levels = []) {
  if (!Array.isArray(levels) || !levels.length) {
    throw new Error("escalation.levels must be a non-empty array");
  }
  return levels.map((level, i) => {
    const targets = (level.targets || []).map((t) => {
      if (!t?.id || !t?.type) {
        throw new Error(
          `levels[${i}] target needs { type: "user"|"schedule", id }`
        );
      }
      const type = t.type === "schedule" ? "schedule" : "user";
      return { type, id: t.id };
    });
    if (!targets.length) {
      throw new Error(`levels[${i}] needs at least one target`);
    }
    return {
      escalation_delay_in_minutes:
        level.delayMinutes ?? level.escalation_delay_in_minutes ?? (i === 0 ? 0 : 15),
      targets,
    };
  });
}

/**
 * Preview levels without calling PD.
 */
export function previewEscalationLevels(cfg = {}) {
  const esc = cfg.alerting?.pagerduty?.escalation || {};
  const levels = esc.levels || defaultLevelsTemplate();
  let rules;
  try {
    rules = levelsToRules(levels);
  } catch (err) {
    return { ok: false, error: err.message, levels };
  }
  return {
    ok: true,
    name: esc.name || "XClaw Escalation",
    policyId: esc.policyId || cfg.alerting?.pagerduty?.escalationPolicyId || null,
    numLoops: esc.numLoops ?? 2,
    levels: rules.map((r, i) => ({
      level: i + 1,
      delayMinutes: r.escalation_delay_in_minutes,
      targets: r.targets,
      description:
        i === 0
          ? "Immediate page (level 1)"
          : `Escalate after ${r.escalation_delay_in_minutes} min if unanswered`,
    })),
  };
}

export function defaultLevelsTemplate() {
  return [
    {
      delayMinutes: 0,
      targets: [{ type: "user", id: "REPLACE_PRIMARY_USER_ID" }],
    },
    {
      delayMinutes: 15,
      targets: [{ type: "schedule", id: "REPLACE_BACKUP_SCHEDULE_ID" }],
    },
    {
      delayMinutes: 30,
      targets: [{ type: "user", id: "REPLACE_MANAGER_USER_ID" }],
    },
  ];
}

/**
 * Apply config levels: create or update policy on PagerDuty.
 */
export async function applyEscalationLevels(cfg = {}, opts = {}) {
  const token = resolveToken(cfg);
  if (!token) {
    return {
      ok: false,
      reason: "no_api_token",
      hint: "Set PAGERDUTY_API_TOKEN or alerting.pagerduty.apiToken",
      preview: previewEscalationLevels(cfg),
    };
  }

  const esc = cfg.alerting?.pagerduty?.escalation || {};
  const levels = opts.levels || esc.levels;
  if (!levels?.length) {
    return {
      ok: false,
      reason: "no_levels",
      hint: "Configure alerting.pagerduty.escalation.levels",
      template: defaultLevelsTemplate(),
    };
  }

  let rules;
  try {
    rules = levelsToRules(levels);
  } catch (err) {
    return { ok: false, reason: "invalid_levels", error: err.message };
  }

  const name = opts.name || esc.name || "XClaw Escalation";
  const numLoops = opts.numLoops ?? esc.numLoops ?? 2;
  const policyId =
    opts.policyId || esc.policyId || cfg.alerting?.pagerduty?.escalationPolicyId;

  const body = {
    escalation_policy: {
      type: "escalation_policy",
      name,
      description: esc.description || "Managed by XClaw",
      num_loops: numLoops,
      escalation_rules: rules,
    },
  };

  if (policyId) {
    // Update existing
    const r = await fetch(`${PD_API}/escalation_policies/${policyId}`, {
      method: "PUT",
      headers: headers(token),
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return {
        ok: false,
        reason: data.error?.message || data.message || `http_${r.status}`,
        status: r.status,
        data,
      };
    }
    return {
      ok: true,
      action: "updated",
      policy: summarize(data.escalation_policy),
    };
  }

  // Create new
  const r = await fetch(`${PD_API}/escalation_policies`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    return {
      ok: false,
      reason: data.error?.message || data.message || `http_${r.status}`,
      status: r.status,
      data,
    };
  }
  return {
    ok: true,
    action: "created",
    policy: summarize(data.escalation_policy),
    hint: "Save policy.id into alerting.pagerduty.escalationPolicyId / escalation.policyId",
  };
}

/**
 * Diff local config levels vs remote policy.
 */
export async function diffEscalationLevels(cfg = {}) {
  const preview = previewEscalationLevels(cfg);
  if (!preview.ok) return preview;

  const policyId =
    cfg.alerting?.pagerduty?.escalation?.policyId ||
    cfg.alerting?.pagerduty?.escalationPolicyId;
  if (!policyId) {
    return {
      ok: true,
      local: preview,
      remote: null,
      note: "No policyId set — apply will create a new policy",
    };
  }

  const remote = await getEscalationPolicy(policyId, {}, cfg);
  if (!remote.ok) return { ok: false, ...remote, local: preview };

  const localRules = preview.levels;
  const remoteRules = remote.policy?.rules || [];
  const mismatches = [];
  const max = Math.max(localRules.length, remoteRules.length);
  for (let i = 0; i < max; i++) {
    const L = localRules[i];
    const R = remoteRules[i];
    if (!L) {
      mismatches.push({ level: i + 1, issue: "extra_on_remote", remote: R });
      continue;
    }
    if (!R) {
      mismatches.push({ level: i + 1, issue: "missing_on_remote", local: L });
      continue;
    }
    if (L.delayMinutes !== R.escalationDelayInMinutes) {
      mismatches.push({
        level: i + 1,
        issue: "delay_mismatch",
        local: L.delayMinutes,
        remote: R.escalationDelayInMinutes,
      });
    }
    const lt = JSON.stringify(L.targets);
    const rt = JSON.stringify(
      (R.targets || []).map((t) => ({ type: t.type, id: t.id }))
    );
    if (lt !== rt) {
      mismatches.push({
        level: i + 1,
        issue: "targets_mismatch",
        local: L.targets,
        remote: R.targets,
      });
    }
  }

  return {
    ok: true,
    inSync: mismatches.length === 0,
    mismatches,
    local: preview,
    remote: remote.policy,
  };
}

function summarize(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    htmlUrl: p.html_url,
    numLoops: p.num_loops,
    rules: (p.escalation_rules || []).map((r, i) => ({
      level: i + 1,
      delayMinutes: r.escalation_delay_in_minutes,
      targets: (r.targets || []).map((t) => ({
        type: t.type,
        id: t.id,
        summary: t.summary,
      })),
    })),
  };
}
