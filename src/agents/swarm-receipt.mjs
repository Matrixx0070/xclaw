/**
 * S1 — Universal swarm node receipts (any work domain, not browser-only).
 *
 * A receipt is durable proof of what a node did: tools, artifacts, effects,
 * optional browser/fabric fields when present.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

/**
 * Roles whose outcomes gate trust / merge (receipt policy).
 * Includes core swarm DAG roles + fabric-bound spawn roles that can change state.
 * Override via opts.criticalRoles or cfg.swarm.criticalRoles.
 */
export const DEFAULT_CRITICAL_ROLES = Object.freeze([
  "implement",
  "verify",
  "critic",
  "research",
  "actor",
  "planner",
]);

/** @deprecated alias — prefer DEFAULT_CRITICAL_ROLES */
export const CRITICAL_ROLES = DEFAULT_CRITICAL_ROLES;

/**
 * Resolve critical role set from opts and/or config.
 * @param {object} [opts]
 * @param {object} [cfg]
 * @returns {string[]}
 */
export function resolveCriticalRoles(opts = {}, cfg = {}) {
  const fromOpts = opts.criticalRoles;
  const fromCfg = cfg?.swarm?.criticalRoles;
  const list = Array.isArray(fromOpts) && fromOpts.length
    ? fromOpts
    : Array.isArray(fromCfg) && fromCfg.length
      ? fromCfg
      : DEFAULT_CRITICAL_ROLES;
  return [...new Set(list.map((x) => String(x).toLowerCase()).filter(Boolean))];
}

function swarmsRoot(cfg) {
  return path.join(
    cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw"),
    "swarms"
  );
}

export function receiptsDir(cfg, swarmId) {
  return path.join(swarmsRoot(cfg), "runs", String(swarmId), "receipts");
}

/**
 * Infer coarse effects from tool names / trace (domain-agnostic).
 */
export function inferEffects(toolTrace = [], extra = {}) {
  const effects = new Set(extra.effects || []);
  const names = [];

  for (const t of toolTrace || []) {
    const n = String(t.name || t.tool || t.toolName || "").toLowerCase();
    if (!n) continue;
    names.push(n);
    if (/bash|shell|exec|terminal/.test(n)) effects.add("shell");
    if (/file_|write|edit|read/.test(n)) effects.add("files");
    if (/browser|xclaw_browser|navigate|screenshot/.test(n)) effects.add("browser");
    if (/git|worktree|commit|pr\b/.test(n)) effects.add("repo");
    if (/commit_gate|tab_lease/.test(n)) effects.add("browser_policy");
    if (/http|fetch|api|curl/.test(n)) effects.add("network");
  }

  if (extra.worktree || extra.workspace) effects.add("workspace");
  if (extra.browser || extra.tabIds?.length) effects.add("browser");
  if (extra.gateIds?.length) effects.add("irreversible_policy");

  return [...effects];
}

function summarizeToolTrace(toolTrace = [], limit = 40) {
  const counts = {};
  const recent = [];
  for (const t of toolTrace || []) {
    const n = String(t.name || t.tool || t.toolName || "unknown");
    counts[n] = (counts[n] || 0) + 1;
    if (recent.length < limit) {
      recent.push({
        name: n,
        ok: t.ok !== false && !t.isError,
        ms: t.ms || t.durationMs || null,
      });
    }
  }
  return { counts, recent, total: (toolTrace || []).length };
}

function extractArtifacts(nodeResult = {}) {
  const artifacts = [];
  const text = String(nodeResult.text || nodeResult.result?.text || "");
  // paths that look like repo files
  const pathRe = /(?:^|[\s`'"])([A-Za-z0-9_./-]+\.(?:mjs|js|ts|tsx|py|go|rs|md|json|yml|yaml|toml))/g;
  let m;
  const seen = new Set();
  while ((m = pathRe.exec(text)) && artifacts.length < 30) {
    const p = m[1];
    if (!seen.has(p)) {
      seen.add(p);
      artifacts.push({ type: "path_mention", path: p });
    }
  }
  if (nodeResult.workspace) {
    artifacts.push({ type: "workspace", path: nodeResult.workspace });
  }
  if (nodeResult.worktree?.path) {
    artifacts.push({ type: "worktree", path: nodeResult.worktree.path });
  }
  return artifacts;
}

/**
 * Build receipt object from a finished node result.
 */
export function buildNodeReceipt(ctx = {}) {
  const {
    swarmId,
    nodeId,
    goal,
    nodeResult = {},
    toolTrace,
    fabricRole,
    successCriteria,
  } = ctx;

  const trace =
    toolTrace ||
    nodeResult.toolTrace ||
    nodeResult.result?.toolTrace ||
    [];

  const toolSummary = summarizeToolTrace(trace);
  const effects = inferEffects(trace, {
    worktree: nodeResult.worktree || nodeResult.result?.worktree,
    workspace: nodeResult.workspace || nodeResult.result?.workspace,
    tabIds: nodeResult.tabIds,
    gateIds: nodeResult.gateIds,
    browser: nodeResult.browser,
  });

  const receipt = {
    id: `rcpt_${randomUUID().slice(0, 8)}`,
    v: 1,
    kind: "swarm_node",
    swarmId: swarmId || null,
    nodeId: nodeId || nodeResult.nodeId || null,
    spawnId: nodeResult.id || nodeResult.spawnId || null,
    sessionId:
      nodeResult.sessionId ||
      nodeResult.result?.sessionId ||
      null,
    role: nodeResult.role || null,
    fabricRole: fabricRole || nodeResult.fabricRole || nodeResult.result?.fabricRole || null,
    goalSnippet: goal ? String(goal).slice(0, 240) : null,
    task: nodeResult.task || null,
    ok: Boolean(nodeResult.ok),
    status: nodeResult.status || (nodeResult.ok ? "done" : "error"),
    code: nodeResult.code || null,
    error: nodeResult.error ? String(nodeResult.error).slice(0, 500) : null,
    attempts: nodeResult.attempts || 1,
    effects,
    tools: toolSummary,
    artifacts: extractArtifacts(nodeResult),
    // Optional domain payloads (filled when present — never required)
    browser: nodeResult.browser || null,
    actionIds: nodeResult.actionIds || [],
    tabIds: nodeResult.tabIds || [],
    gateIds: nodeResult.gateIds || [],
    networkFlowCount: nodeResult.networkFlowCount ?? null,
    successCriteria: successCriteria || nodeResult.successCriteria || null,
    textPreview: String(nodeResult.text || nodeResult.result?.text || "").slice(
      0,
      500
    ),
    at: new Date().toISOString(),
  };

  return receipt;
}

/**
 * Persist receipt under runs/<swarmId>/receipts/<nodeId>.json
 */
export async function writeNodeReceipt(cfg, receipt) {
  if (!receipt?.swarmId || !receipt?.nodeId) {
    return { ok: false, code: "RECEIPT_IDS_REQUIRED" };
  }
  const dir = receiptsDir(cfg, receipt.swarmId);
  await fs.mkdir(dir, { recursive: true });
  const safeNode = String(receipt.nodeId).replace(/[^a-zA-Z0-9._-]/g, "_");
  const fp = path.join(dir, `${safeNode}.json`);
  await fs.writeFile(fp, JSON.stringify(receipt, null, 2) + "\n");
  // also index by receipt id
  const idFp = path.join(dir, `id-${receipt.id}.json`);
  await fs.writeFile(idFp, JSON.stringify({ path: fp, id: receipt.id, nodeId: receipt.nodeId }, null, 2) + "\n");
  return { ok: true, path: fp, receipt };
}

export async function readNodeReceipt(cfg, swarmId, nodeId) {
  try {
    const safeNode = String(nodeId).replace(/[^a-zA-Z0-9._-]/g, "_");
    const fp = path.join(receiptsDir(cfg, swarmId), `${safeNode}.json`);
    return JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    return null;
  }
}

export async function listNodeReceipts(cfg, swarmId) {
  const dir = receiptsDir(cfg, swarmId);
  let files = [];
  try {
    files = (await fs.readdir(dir)).filter(
      (f) => f.endsWith(".json") && !f.startsWith("id-")
    );
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")));
    } catch {
      /* */
    }
  }
  return out;
}

/**
 * Build + write in one call; attach path onto nodeResult.
 */
export async function attachNodeReceipt(cfg, nodeResult, ctx = {}) {
  const receipt = buildNodeReceipt({
    ...ctx,
    nodeResult,
    toolTrace: ctx.toolTrace || nodeResult.toolTrace || nodeResult.result?.toolTrace,
  });
  const written = await writeNodeReceipt(cfg, receipt);
  if (written.ok) {
    nodeResult.receiptId = receipt.id;
    nodeResult.receiptPath = written.path;
    nodeResult.receipt = {
      id: receipt.id,
      ok: receipt.ok,
      effects: receipt.effects,
      toolsTotal: receipt.tools?.total ?? 0,
      artifacts: receipt.artifacts?.length ?? 0,
      path: written.path,
    };
  }
  return { nodeResult, receipt, written };
}

export function receiptsRequired(cfg = {}, input = {}) {
  if (input.requireReceipts === true) return true;
  if (input.requireReceipts === false) return false;
  if (cfg?.swarm?.requireReceipts === true) return true;
  return (
    process.env.XCLAW_SWARM_REQUIRE_RECEIPTS === "1" ||
    process.env.XCLAW_SWARM_REQUIRE_RECEIPTS === "true"
  );
}

/**
 * Whether failed/skipped critical nodes must carry receipts.
 */
export function failedReceiptsRequired(cfg = {}, input = {}) {
  if (input.requireFailedReceipts === true || input.requireFailed === true)
    return true;
  if (input.requireFailedReceipts === false) return false;
  if (cfg?.swarm?.requireFailedReceipts === true) return true;
  return (
    process.env.XCLAW_SWARM_REQUIRE_FAILED_RECEIPTS === "1" ||
    process.env.XCLAW_SWARM_REQUIRE_FAILED_RECEIPTS === "true"
  );
}

/**
 * S2 — Does this node result have a usable receipt?
 */
export function hasReceipt(nodeResult = {}) {
  if (nodeResult.receiptId || nodeResult.receiptPath) return true;
  if (nodeResult.receipt?.id) return true;
  return false;
}

/**
 * Vote weight multiplier from receipt quality (1.0 base).
 * Missing receipt → 0.25 (or 0 if hard require for that role).
 */
export function receiptVoteWeight(nodeResult = {}, opts = {}) {
  const hard = opts.hard === true;
  if (!hasReceipt(nodeResult)) {
    return hard ? 0 : 0.25;
  }
  const r = nodeResult.receipt || {};
  let w = 1.0;
  if (r.ok === false && nodeResult.ok) w *= 0.8; // inconsistent
  if ((r.toolsTotal || 0) > 0) w += 0.15;
  if ((r.artifacts || 0) > 0 || (Array.isArray(r.artifacts) && r.artifacts.length)) w += 0.1;
  if (Array.isArray(r.effects) && r.effects.length) w += 0.05;
  return Math.min(1.5, w);
}

/**
 * S2 merge/vote gate: critical roles should present receipts.
 *
 * Options:
 *   require / requireReceipts — successful critical nodes must have receipts
 *   requireFailedReceipts — failed or skipped critical nodes must also have receipts
 *                           (durable proof of failure / UPSTREAM_FAILED)
 *   criticalRoles — default DEFAULT_CRITICAL_ROLES (implement, verify, critic,
 *                   research, actor, planner); override via opts or cfg.swarm.criticalRoles
 *   cfg — optional config for resolveCriticalRoles
 *   forbidPending — if true, any status=pending fails the policy
 *
 * @returns {{ ok: boolean, reasons: string[], summary: object }}
 */
export function evaluateReceiptPolicy(results = [], opts = {}) {
  const require = opts.require === true || opts.requireReceipts === true;
  const requireFailed =
    opts.requireFailedReceipts === true || opts.requireFailed === true;
  const forbidPending = opts.forbidPending === true;
  const criticalRoles = new Set(resolveCriticalRoles(opts, opts.cfg || {}));
  const reasons = [];
  let withReceipt = 0;
  let withoutReceipt = 0;
  const criticalMissing = [];
  const criticalFailedMissing = [];
  const pendingIds = [];

  for (const r of results || []) {
    // skipped nodes have receipts too after S1 — still count
    if (hasReceipt(r)) withReceipt += 1;
    else withoutReceipt += 1;

    const role = String(r.role || "").toLowerCase();
    const id = r.nodeId || r.id || role || "unknown";
    const status = String(r.status || "").toLowerCase();

    if (forbidPending && status === "pending") {
      pendingIds.push(id);
    }

    if (!criticalRoles.has(role)) continue;
    // pending: not yet a terminal success/fail
    if (status === "pending") continue;

    if (r.ok && !hasReceipt(r)) {
      criticalMissing.push(id);
      continue;
    }

    // Failed or skipped critical work without durable proof
    const terminalFail =
      r.ok === false ||
      status === "skipped" ||
      status === "error" ||
      status === "failed";
    if (requireFailed && terminalFail && !hasReceipt(r)) {
      criticalFailedMissing.push(id);
    }
  }

  if (require && criticalMissing.length) {
    reasons.push(
      `receipt required but missing for: ${criticalMissing.join(", ")}`
    );
  }
  if (requireFailed && criticalFailedMissing.length) {
    reasons.push(
      `failed/skipped receipt required but missing for: ${criticalFailedMissing.join(", ")}`
    );
  }
  if (forbidPending && pendingIds.length) {
    reasons.push(`pending nodes not allowed: ${pendingIds.join(", ")}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    summary: {
      withReceipt,
      withoutReceipt,
      criticalMissing,
      criticalFailedMissing,
      pendingIds,
      require,
      requireFailedReceipts: requireFailed,
      forbidPending,
    },
  };
}

/**
 * Attach receipt summary onto a swarm run patch object.
 */
export function buildRunReceiptSummary(results = []) {
  const byStatus = { ok: 0, fail: 0, skipped: 0 };
  let withReceipt = 0;
  const paths = [];
  for (const r of results || []) {
    if (r.status === "skipped") byStatus.skipped += 1;
    else if (r.ok) byStatus.ok += 1;
    else byStatus.fail += 1;
    if (hasReceipt(r)) {
      withReceipt += 1;
      if (r.receiptPath) paths.push(r.receiptPath);
    }
  }
  return {
    nodes: results?.length || 0,
    withReceipt,
    withoutReceipt: (results?.length || 0) - withReceipt,
    byStatus,
    receiptPaths: paths.slice(0, 50),
  };
}


export default {
  DEFAULT_CRITICAL_ROLES,
  CRITICAL_ROLES,
  resolveCriticalRoles,
  buildNodeReceipt,
  writeNodeReceipt,
  readNodeReceipt,
  listNodeReceipts,
  attachNodeReceipt,
  inferEffects,
  receiptsRequired,
  failedReceiptsRequired,
  hasReceipt,
  receiptVoteWeight,
  evaluateReceiptPolicy,
  buildRunReceiptSummary,
};
