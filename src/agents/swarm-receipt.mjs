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

/** Allowed receipt.status values (strict enum). */
export const RECEIPT_STATUS_ENUM = Object.freeze([
  "done",
  "error",
  "skipped",
  "failed",
  "aborted",
  "pending",
  "running",
]);

/**
 * Map arbitrary node status strings into RECEIPT_STATUS_ENUM.
 */
export function normalizeReceiptStatus(status, ok) {
  const raw = String(status || "").toLowerCase().trim();
  if (RECEIPT_STATUS_ENUM.includes(raw)) return raw;
  // common aliases
  if (raw === "success" || raw === "ok" || raw === "complete" || raw === "completed") {
    return "done";
  }
  if (raw === "fail" || raw === "failure" || raw === "err") return "error";
  if (raw === "skip" || raw === "cancelled" || raw === "canceled") return "skipped";
  if (raw === "abort" || raw === "aborted") return "aborted";
  // fall back from ok flag
  if (ok === true) return "done";
  if (ok === false) return "error";
  return "error";
}

/** JSON-schema-like contract for receipt v1 (no external AJV dependency). */
export const RECEIPT_SCHEMA_V1 = Object.freeze({
  $id: "xclaw://swarm-receipt/v1",
  type: "object",
  required: [
    "id",
    "v",
    "kind",
    "swarmId",
    "nodeId",
    "ok",
    "status",
    "at",
  ],
  properties: {
    id: { type: "string", pattern: "^rcpt_" },
    v: { type: "number", const: 1 },
    kind: { type: "string", const: "swarm_node" },
    swarmId: { type: "string", minLength: 1 },
    nodeId: { type: "string", minLength: 1 },
    ok: { type: "boolean" },
    status: {
      type: "string",
      enum: [
        "done",
        "error",
        "skipped",
        "failed",
        "aborted",
        "pending",
        "running",
      ], // keep in sync with RECEIPT_STATUS_ENUM
    },
    code: { type: ["string", "null"] },
    error: { type: ["string", "null"] },
    role: { type: ["string", "null"] },
    effects: { type: "array" },
    tools: { type: ["object", "null"] },
    artifacts: { type: "array" },
    at: { type: "string", minLength: 1 },
  },
});

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function matchesType(v, spec) {
  const allowed = Array.isArray(spec) ? spec : [spec];
  const t = typeOf(v);
  for (const a of allowed) {
    if (a === "null" && v === null) return true;
    if (a === t) return true;
    // JSON schema "number" includes integers
    if (a === "number" && t === "number" && !Number.isNaN(v)) return true;
  }
  return false;
}

/**
 * Validate a receipt against RECEIPT_SCHEMA_V1 (hand-rolled).
 * @returns {{ ok: boolean, errors: string[], schema: string }}
 */
export function validateReceiptShape(receipt, opts = {}) {
  const errors = [];
  const schema = RECEIPT_SCHEMA_V1;
  if (receipt == null || typeOf(receipt) !== "object") {
    return {
      ok: false,
      errors: ["receipt must be a non-null object"],
      schema: schema.$id,
    };
  }

  for (const key of schema.required) {
    if (key === "ok") {
      if (typeof receipt.ok !== "boolean") {
        errors.push("missing or invalid required field: ok (boolean)");
      }
      continue;
    }
    if (receipt[key] === undefined || receipt[key] === null || receipt[key] === "") {
      errors.push(`missing required field: ${key}`);
    }
  }

  const props = schema.properties;
  for (const [key, rules] of Object.entries(props)) {
    if (receipt[key] === undefined) continue;
    const val = receipt[key];
    if (rules.type && !matchesType(val, rules.type)) {
      errors.push(
        `${key} type want ${JSON.stringify(rules.type)} got ${typeOf(val)}`
      );
      continue;
    }
    if (rules.const !== undefined && val !== rules.const) {
      errors.push(`${key} must equal ${JSON.stringify(rules.const)}`);
    }
    if (rules.pattern && typeof val === "string") {
      const re = new RegExp(rules.pattern);
      if (!re.test(val)) errors.push(`${key} must match ${rules.pattern}`);
    }
    if (rules.minLength != null && typeof val === "string") {
      if (val.length < rules.minLength) {
        errors.push(`${key} minLength ${rules.minLength}`);
      }
    }
    if (rules.enum && !rules.enum.includes(val)) {
      // Status enum is always strict; other enums respect strictStatus opt
      const enforce =
        key === "status" || opts.strictStatus === true || opts.strictStatus === undefined;
      // status: always enforce; for future enums default strict unless strictStatus=false
      if (key === "status") {
        errors.push(
          `status must be one of ${RECEIPT_STATUS_ENUM.join("|")} (got ${JSON.stringify(val)})`
        );
      } else if (opts.strictStatus !== false) {
        errors.push(`${key} must be one of ${rules.enum.join("|")}`);
      }
    }
  }

  // Cross-field: success should not look like error status when strict
  if (opts.strictOutcome === true && receipt.ok === true) {
    const st = String(receipt.status || "");
    if (["error", "failed", "skipped", "aborted"].includes(st)) {
      errors.push(`ok=true inconsistent with status=${st}`);
    }
  }
  if (opts.strictOutcome === true && receipt.ok === false) {
    const st = String(receipt.status || "");
    if (st === "done") {
      errors.push("ok=false inconsistent with status=done");
    }
  }

  // Deduplicate missing ok messages
  const uniq = [...new Set(errors)];
  return {
    ok: uniq.length === 0,
    errors: uniq,
    schema: schema.$id,
  };
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
    status: normalizeReceiptStatus(
      nodeResult.status || (nodeResult.ok ? "done" : "error"),
      Boolean(nodeResult.ok)
    ),
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
export async function writeNodeReceipt(cfg, receipt, writeOpts = {}) {
  if (!receipt?.swarmId || !receipt?.nodeId) {
    return { ok: false, code: "RECEIPT_IDS_REQUIRED" };
  }
  const skipShape = writeOpts.skipShapeValidation === true;
  if (!skipShape) {
    const shape = validateReceiptShape(receipt, {
      strictStatus: writeOpts.strictStatus !== false, // default on
      strictOutcome: writeOpts.strictOutcome === true,
    });
    if (!shape.ok) {
      return {
        ok: false,
        code: "RECEIPT_SCHEMA_INVALID",
        errors: shape.errors,
        schema: shape.schema,
      };
    }
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

export async function readNodeReceipt(cfg, swarmId, nodeId, readOpts = {}) {
  try {
    const safeNode = String(nodeId).replace(/[^a-zA-Z0-9._-]/g, "_");
    const fp = path.join(receiptsDir(cfg, swarmId), `${safeNode}.json`);
    const data = JSON.parse(await fs.readFile(fp, "utf8"));
    if (readOpts.validate === true) {
      const shape = validateReceiptShape(data, readOpts);
      if (!shape.ok) {
        return { __invalid: true, errors: shape.errors, data };
      }
    }
    return data;
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



// Receipt-status migration framework (hooks/rollback/idempotency, ~540
// lines) deleted 2026-08-23 (S6b cleanup): its migration completed —
// dry-run over the live store reported changed:0 invalid:0 — and no
// production code ever imported it (only its own script + tests).


export default {
  DEFAULT_CRITICAL_ROLES,
  CRITICAL_ROLES,
  resolveCriticalRoles,
  RECEIPT_SCHEMA_V1,
  RECEIPT_STATUS_ENUM,
  normalizeReceiptStatus,
  validateReceiptShape,
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
