/**
 * PagerDuty REST API helpers for escalation policies / services.
 * Requires a REST API token (not the Events routing key).
 * https://developer.pagerduty.com/api-reference/
 */
const PD_API = "https://api.pagerduty.com";

function headers(token) {
  return {
    Authorization: `Token token=${token}`,
    Accept: "application/vnd.pagerduty+json;version=2",
    "Content-Type": "application/json",
  };
}

function resolveToken(opts = {}, cfg = {}) {
  return (
    opts.token ||
    cfg.alerting?.pagerduty?.apiToken ||
    process.env.PAGERDUTY_API_TOKEN ||
    process.env.PD_API_TOKEN ||
    null
  );
}

async function pdFetch(path, { token, method = "GET", body } = {}) {
  if (!token) return { ok: false, reason: "no_api_token" };
  const r = await fetch(`${PD_API}${path}`, {
    method,
    headers: headers(token),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      reason: data.error?.message || data.message || `http_${r.status}`,
      data,
    };
  }
  return { ok: true, data };
}

/** List escalation policies. */
export async function listEscalationPolicies(opts = {}, cfg = {}) {
  const token = resolveToken(opts, cfg);
  const limit = opts.limit || 25;
  const q = new URLSearchParams({ limit: String(limit) });
  if (opts.query) q.set("query", opts.query);
  const res = await pdFetch(`/escalation_policies?${q}`, { token });
  if (!res.ok) return res;
  return {
    ok: true,
    policies: (res.data.escalation_policies || []).map(summarizePolicy),
  };
}

/** Get one escalation policy. */
export async function getEscalationPolicy(id, opts = {}, cfg = {}) {
  const token = resolveToken(opts, cfg);
  const res = await pdFetch(`/escalation_policies/${id}`, { token });
  if (!res.ok) return res;
  return { ok: true, policy: summarizePolicy(res.data.escalation_policy) };
}

/** List services (each service has an escalation policy + integrations). */
export async function listServices(opts = {}, cfg = {}) {
  const token = resolveToken(opts, cfg);
  const limit = opts.limit || 25;
  const q = new URLSearchParams({
    limit: String(limit),
    include: ["escalation_policy", "integrations"],
  });
  // PD include is repeated params — simplify without include for compatibility
  const res = await pdFetch(`/services?limit=${limit}`, { token });
  if (!res.ok) return res;
  return {
    ok: true,
    services: (res.data.services || []).map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      escalationPolicyId: s.escalation_policy?.id,
      escalationPolicyName: s.escalation_policy?.summary,
      htmlUrl: s.html_url,
    })),
  };
}

/**
 * Recommended setup report: does config point at a usable PD path?
 */
export async function pagerDutySetupReport(cfg = {}) {
  const pd = cfg.alerting?.pagerduty || {};
  const routingKey =
    pd.routingKey || process.env.PAGERDUTY_ROUTING_KEY || process.env.PD_ROUTING_KEY;
  const apiToken = resolveToken({}, cfg);
  const report = {
    eventsApi: {
      configured: Boolean(routingKey),
      hint: routingKey
        ? "Events API routing key present — triggers will create incidents"
        : "Set alerting.pagerduty.routingKey or PAGERDUTY_ROUTING_KEY",
    },
    restApi: {
      configured: Boolean(apiToken),
      hint: apiToken
        ? "REST token present — can list policies/services"
        : "Set alerting.pagerduty.apiToken or PAGERDUTY_API_TOKEN to manage policies via API",
    },
    escalationPolicyId: pd.escalationPolicyId || null,
    serviceId: pd.serviceId || null,
    policies: null,
    services: null,
    guidance: [
      "1. In PagerDuty: People → Escalation Policies → New (add layers: primary on-call → backup → manager)",
      "2. Service Directory → New Service → assign that escalation policy",
      "3. On the service: Integrations → Events API V2 → copy Integration Key into XClaw routingKey",
      "4. Optional: store policy/service ids in config for documentation and doctor checks",
    ],
  };

  if (apiToken) {
    const pols = await listEscalationPolicies({}, cfg);
    if (pols.ok) report.policies = pols.policies;
    else report.policiesError = pols.reason;
    const svcs = await listServices({}, cfg);
    if (svcs.ok) report.services = svcs.services;
    else report.servicesError = svcs.reason;
  }

  return report;
}

function summarizePolicy(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    summary: p.summary,
    htmlUrl: p.html_url,
    numLoops: p.num_loops,
    rules: (p.escalation_rules || []).map((r, i) => ({
      level: i + 1,
      escalationDelayInMinutes: r.escalation_delay_in_minutes,
      targets: (r.targets || []).map((t) => ({
        type: t.type,
        id: t.id,
        summary: t.summary,
      })),
    })),
  };
}

/**
 * Create a simple 2-level escalation policy (requires REST token + user/schedule ids).
 * Prefer configuring in the PD UI unless you know target ids.
 */
export async function createBasicEscalationPolicy(params = {}, cfg = {}) {
  const token = resolveToken(params, cfg);
  if (!token) return { ok: false, reason: "no_api_token" };
  if (!params.name || !params.targets?.length) {
    return {
      ok: false,
      reason: "name_and_targets_required",
      hint: "targets: [{ type: 'user'|'schedule', id: 'PXX...' }] per layer",
    };
  }

  const rules = params.targets.map((layer, i) => ({
    escalation_delay_in_minutes: layer.delayMinutes ?? (i === 0 ? 0 : 15),
    targets: (layer.targets || [layer]).map((t) => ({
      type: t.type, // user | schedule
      id: t.id,
    })),
  }));

  const body = {
    escalation_policy: {
      type: "escalation_policy",
      name: params.name,
      description: params.description || "Created by XClaw",
      num_loops: params.numLoops ?? 2,
      escalation_rules: rules,
    },
  };

  const res = await pdFetch("/escalation_policies", {
    token,
    method: "POST",
    body,
  });
  if (!res.ok) return res;
  return { ok: true, policy: summarizePolicy(res.data.escalation_policy) };
}
