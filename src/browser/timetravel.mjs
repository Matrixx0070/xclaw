/**
 * Horizon 5 — Time-travel: replay plans + synthetic origins from traces
 *
 * Inputs:
 *   - flows.jsonl (MITM)
 *   - action-bindings.jsonl (sense)
 *   - optional proof bundles (truth export)
 *
 * Outputs:
 *   - ReplayPlan: ordered steps for offline/debug
 *   - SyntheticOrigin: host → canned responses for offline agent runs
 *   - CausalScore: did actions produce expected network effects?
 */

import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { mitmConfdir, readMitmFlows } from "./mitm.mjs";
import { readActionBindings, assertOutcome } from "./sense.mjs";
import { exportProofBundle, loadPolicy } from "./truth.mjs";

/**
 * Load unified timeline from confdir traces.
 */
export async function loadTimeline(opts = {}) {
  const confdir = opts.confdir || mitmConfdir(opts.cfg || null);
  const limit = opts.limit || 500;
  let flows = [];
  try {
    flows = await readMitmFlows(
      opts.cfg || null,
      { limit, sinceTs: opts.sinceTs }
    );
  } catch {
    flows = [];
  }
  // client-side since filter
  if (opts.sinceTs) {
    flows = flows.filter((f) => Number(f.ts) >= Number(opts.sinceTs));
  }

  let bindings = [];
  try {
    bindings = await readActionBindings({ cfg: opts.cfg || null, limit });
  } catch {
    bindings = [];
  }

  // Optional proof file
  let proof = null;
  if (opts.proofPath) {
    try {
      proof = JSON.parse(await fs.readFile(opts.proofPath, "utf8"));
      if (proof.flows?.length && !flows.length) flows = proof.flows;
      if (proof.bindings?.length && !bindings.length) bindings = proof.bindings;
    } catch {
      /* */
    }
  }

  const events = [];
  for (const f of flows) {
    events.push({
      kind: "flow",
      ts: Number(f.ts) || 0,
      flow: f,
    });
  }
  for (const b of bindings) {
    events.push({
      kind: "action",
      ts: Number(b.ts) || 0,
      action: b,
    });
  }
  events.sort((a, b) => a.ts - b.ts);

  return {
    confdir,
    flowCount: flows.length,
    bindingCount: bindings.length,
    events,
    flows,
    bindings,
  };
}

/**
 * Build a replay plan from timeline (human/agent readable).
 */
export function buildReplayPlan(timeline, opts = {}) {
  const steps = [];
  for (const ev of timeline.events || []) {
    if (ev.kind === "action") {
      const a = ev.action;
      steps.push({
        type: "action",
        ts: ev.ts,
        actionId: a.actionId,
        label: a.label,
        tabId: a.tabId,
        flowCount: a.flowCount || (a.flows || []).length,
        flows: (a.flows || []).slice(0, opts.maxFlowsPerAction || 10),
      });
    } else if (ev.kind === "flow" && opts.includeUnboundFlows) {
      const f = ev.flow;
      steps.push({
        type: "flow",
        ts: ev.ts,
        method: f.method,
        host: f.host,
        path: f.path,
        status: f.status,
      });
    }
  }
  return {
    version: 1,
    kind: "xclaw-replay-plan",
    stepCount: steps.length,
    steps,
  };
}

/**
 * Causal correctness score for a goal window.
 *
 * @param {object} expect
 * @param {Array} expect.network — list of assertOutcome expectations
 * @param {object} timeline
 */
export function scoreCausal(expect = {}, timeline = {}) {
  const failures = [];
  const checks = [];
  const flows = timeline.flows || [];
  const bindings = timeline.bindings || [];

  // 1) Network expectations
  const netExpect = expect.network || expect.flows || [];
  for (let i = 0; i < netExpect.length; i++) {
    const exp = netExpect[i];
    const verdict = assertOutcome(exp, flows);
    checks.push({ type: "network", index: i, ...verdict });
    if (!verdict.ok) {
      failures.push(`network[${i}]:${(verdict.failures || []).join(";")}`);
    }
  }

  // 2) Required actions
  const needActions = expect.actions || expect.requireActions || [];
  for (const label of needActions) {
    const hit = bindings.some(
      (b) =>
        b.label === label ||
        b.actionId === label ||
        (b.label && String(b.label).includes(label))
    );
    checks.push({ type: "action", label, ok: hit });
    if (!hit) failures.push(`action_missing:${label}`);
  }

  // 3) Action→flow binding integrity
  if (expect.requireBindings) {
    const unbound = bindings.filter((b) => !b.flowCount && !(b.flows || []).length);
    // only fail if MITM was expected
    if (expect.requireBindings === "strict" && unbound.length) {
      failures.push(`unbound_actions:${unbound.length}`);
    }
    checks.push({
      type: "bindings",
      total: bindings.length,
      unbound: unbound.length,
      ok: expect.requireBindings !== "strict" || unbound.length === 0,
    });
  }

  // 4) Min/max flow counts
  if (expect.minFlows != null && flows.length < Number(expect.minFlows)) {
    failures.push(`minFlows:${flows.length}<${expect.minFlows}`);
  }
  if (expect.maxFlows != null && flows.length > Number(expect.maxFlows)) {
    failures.push(`maxFlows:${flows.length}>${expect.maxFlows}`);
  }

  // 5) Forbidden hosts (exfil check)
  for (const host of expect.forbidHosts || []) {
    const h = String(host).toLowerCase();
    const hit = flows.some((f) => String(f.host || "").toLowerCase().includes(h));
    if (hit) failures.push(`forbidHost:${host}`);
  }

  const pass = failures.length === 0;
  return {
    pass,
    failures,
    checks,
    flowCount: flows.length,
    bindingCount: bindings.length,
    score: pass ? 1 : Math.max(0, 1 - failures.length / Math.max(1, checks.length || failures.length)),
  };
}

/**
 * Group recorded flows into synthetic origin responses by host+path+method.
 */
export function buildSyntheticOriginCatalog(flows = []) {
  /** @type {Map<string, object>} */
  const map = new Map();
  for (const f of flows) {
    if (f.kind && f.kind !== "http") continue;
    const method = String(f.method || "GET").toUpperCase();
    const host = String(f.host || "unknown").toLowerCase();
    const p = String(f.path || "/");
    const key = `${method} ${host}${p}`;
    // last write wins (final state)
    map.set(key, {
      method,
      host,
      path: p,
      status: Number(f.status) || 200,
      contentType: f.content_type || f.contentType || "application/octet-stream",
      body: f.res_body || f.body || "",
      url: f.url,
    });
  }
  return [...map.values()];
}

/**
 * Start a minimal offline HTTP server that serves synthetic catalog.
 * Host matching uses Host header; path must match recorded path.
 * @returns {Promise<{ server, port, url, catalog, close }>}
 */
export async function startSyntheticOrigin(flowsOrCatalog, opts = {}) {
  const catalog = Array.isArray(flowsOrCatalog) && flowsOrCatalog[0]?.status != null
    ? flowsOrCatalog
    : buildSyntheticOriginCatalog(flowsOrCatalog || []);

  const byKey = new Map();
  for (const e of catalog) {
    byKey.set(`${e.method} ${e.path}`, e);
    byKey.set(`${e.method} ${e.host}${e.path}`, e);
  }

  const server = http.createServer((req, res) => {
    const method = (req.method || "GET").toUpperCase();
    const host = String(req.headers.host || "").split(":")[0].toLowerCase();
    let pathname = "/";
    try {
      pathname = new URL(req.url || "/", "http://localhost").pathname;
    } catch {
      pathname = req.url || "/";
    }
    const hit =
      byKey.get(`${method} ${host}${pathname}`) ||
      byKey.get(`${method} ${pathname}`) ||
      null;

    if (!hit) {
      res.writeHead(404, { "content-type": "text/plain", "x-xclaw-synthetic": "miss" });
      res.end(`synthetic miss ${method} ${pathname}`);
      return;
    }
    const body = hit.body != null ? String(hit.body) : "";
    res.writeHead(hit.status || 200, {
      "content-type": hit.contentType || "text/plain",
      "x-xclaw-synthetic": "1",
      "x-xclaw-synthetic-host": hit.host || "",
    });
    res.end(body);
  });

  const port = opts.port || 0;
  await new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
  });
  const addr = server.address();
  const actualPort = typeof addr === "object" ? addr.port : port;
  return {
    server,
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    catalog,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/**
 * Convenience: timeline → plan + causal score + optional proof export.
 */
export async function timeTravelReport(opts = {}) {
  const timeline = await loadTimeline(opts);
  const plan = buildReplayPlan(timeline, {
    includeUnboundFlows: opts.includeUnboundFlows !== false,
  });
  const causal = scoreCausal(opts.expect || {}, timeline);
  let proof = null;
  if (opts.exportProof) {
    proof = await exportProofBundle({
      cfg: opts.cfg || null,
      limit: opts.limit || 200,
      sinceTs: opts.sinceTs,
      dest: opts.proofDest,
    });
  }
  return {
    version: 1,
    kind: "xclaw-timetravel-report",
    timeline: {
      flowCount: timeline.flowCount,
      bindingCount: timeline.bindingCount,
      eventCount: timeline.events.length,
    },
    plan,
    causal,
    proof,
    policy: opts.includePolicy ? await loadPolicy(opts.cfg || null) : undefined,
  };
}

export default {
  loadTimeline,
  buildReplayPlan,
  scoreCausal,
  buildSyntheticOriginCatalog,
  startSyntheticOrigin,
  timeTravelReport,
};
