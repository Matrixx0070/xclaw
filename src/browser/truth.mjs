/**
 * Horizon 2 — Truth as control plane
 *
 * Policy DSL (JS + mitmproxy addon):
 *   allow | deny/block | map | require (outcome expectations)
 *
 * Proof export:
 *   redacted, self-describing bundle for audit / eval / replay prep
 *
 * Agent-loop integration:
 *   afterBrowserToolTruth() — optional automatic outcome checks
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { mitmConfdir, isMitmEnabled, readMitmFlows, findMitmCaCert } from "./mitm.mjs";
import { assertOutcome, readActionBindings, networkDeltaSince } from "./sense.mjs";

export const POLICY_VERSION = 1;

/**
 * Default empty policy.
 * @returns {{ version: number, rules: Array<object> }}
 */
export function emptyPolicy() {
  return { version: POLICY_VERSION, rules: [] };
}

/**
 * Load policy from confdir/policy.json (and merge env-derived rules).
 */
export async function loadPolicy(cfg = null) {
  const confdir = mitmConfdir(cfg);
  let filePolicy = emptyPolicy();
  try {
    const raw = await fs.readFile(path.join(confdir, "policy.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.rules)) {
      filePolicy = {
        version: Number(parsed.version) || POLICY_VERSION,
        rules: parsed.rules,
        meta: parsed.meta || {},
      };
    }
  } catch {
    /* no file */
  }
  return mergeEnvRules(filePolicy);
}

/**
 * Env rules → policy rules (compat with Horizon 0/1 env).
 */
export function mergeEnvRules(policy) {
  const rules = [...(policy.rules || [])];
  const block = process.env.XCLAW_MITM_BLOCK || "";
  if (block.trim()) {
    for (const part of block.split(",").map((s) => s.trim()).filter(Boolean)) {
      rules.push({
        id: `env-block:${part}`,
        action: "block",
        match: { hostOrPathContains: part },
        source: "env",
      });
    }
  }
  const mapRaw = process.env.XCLAW_MITM_MAP || "";
  if (mapRaw.trim()) {
    for (const part of mapRaw.split(",")) {
      if (!part.includes("=>")) continue;
      const [a, b] = part.split("=>", 2).map((s) => s.trim());
      if (!a) continue;
      rules.push({
        id: `env-map:${a}`,
        action: "map",
        match: { pathPrefix: a },
        rewrite: { pathPrefix: b },
        source: "env",
      });
    }
  }
  const allow = process.env.XCLAW_MITM_ALLOWLIST || "";
  if (allow.trim()) {
    rules.push({
      id: "env-allowlist",
      action: "allowlist",
      match: { hosts: allow.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) },
      source: "env",
    });
  }
  return { ...policy, rules };
}

/**
 * Save policy.json (does not include ephemeral env-sourced rules).
 */
export async function savePolicy(policy, cfg = null) {
  const confdir = mitmConfdir(cfg);
  await fs.mkdir(confdir, { recursive: true });
  const clean = {
    version: POLICY_VERSION,
    meta: {
      ...(policy.meta || {}),
      updatedAt: new Date().toISOString(),
    },
    rules: (policy.rules || []).filter((r) => r.source !== "env"),
  };
  const dest = path.join(confdir, "policy.json");
  await fs.writeFile(dest, JSON.stringify(clean, null, 2) + "\n");
  return { ok: true, path: dest, ruleCount: clean.rules.length };
}

/**
 * Evaluate whether a flow/request matches a rule.
 */
export function matchRule(rule, ctx) {
  const m = rule.match || {};
  const host = String(ctx.host || "").toLowerCase();
  const pathStr = String(ctx.path || ctx.url || "");
  const method = String(ctx.method || "").toUpperCase();
  const url = String(ctx.url || pathStr);

  if (m.hosts && Array.isArray(m.hosts)) {
    const ok = m.hosts.some(
      (h) => host === h || host.endsWith("." + h) || host.includes(String(h).toLowerCase())
    );
    if (!ok) return false;
  }
  if (m.hostContains) {
    if (!host.includes(String(m.hostContains).toLowerCase())) return false;
  }
  if (m.hostOrPathContains) {
    const blob = (host + pathStr).toLowerCase();
    if (!blob.includes(String(m.hostOrPathContains).toLowerCase())) return false;
  }
  if (m.pathPrefix) {
    if (!pathStr.startsWith(m.pathPrefix) && !url.includes(m.pathPrefix)) return false;
  }
  if (m.pathContains) {
    if (!pathStr.includes(m.pathContains) && !url.includes(m.pathContains)) return false;
  }
  if (m.method) {
    if (method !== String(m.method).toUpperCase()) return false;
  }
  if (m.urlRegex) {
    try {
      if (!new RegExp(m.urlRegex, "i").test(url)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Decide policy action for a request context.
 * @returns {{ action: string, rule?: object }}
 */
export function evaluateRequestPolicy(policy, ctx) {
  const rules = policy?.rules || [];
  // allowlist rule: if present, non-matching hosts are still proxied but
  // marked outside_allowlist (logging policy) — block rules still apply.
  for (const rule of rules) {
    if (rule.action === "block" || rule.action === "deny") {
      if (matchRule(rule, ctx)) {
        return { action: "block", rule };
      }
    }
  }
  for (const rule of rules) {
    if (rule.action === "map" && rule.rewrite) {
      if (matchRule(rule, ctx)) {
        return { action: "map", rule };
      }
    }
  }
  return { action: "allow" };
}

/**
 * Apply path map rewrite.
 */
export function applyPathRewrite(pathStr, rule) {
  const prefix = rule?.match?.pathPrefix;
  const next = rule?.rewrite?.pathPrefix;
  if (prefix == null || next == null) return pathStr;
  if (pathStr.startsWith(prefix)) {
    return next + pathStr.slice(prefix.length);
  }
  return pathStr;
}

/**
 * Collect "require" rules (outcome expectations) for agent-side checks.
 */
export function requireRules(policy) {
  return (policy?.rules || []).filter((r) => r.action === "require" || r.action === "expect");
}

/**
 * Run require-rules against recent flows / binding.
 */
export async function evaluateRequireRules(policy, opts = {}) {
  const rules = requireRules(policy);
  if (!rules.length) {
    return { ok: true, checked: 0, results: [] };
  }
  let flows = opts.flows;
  if (!flows) {
    if (opts.actionId) {
      const bindings = await readActionBindings({ cfg: opts.cfg || null, limit: 100 });
      const hit = bindings.find((b) => b.actionId === opts.actionId);
      flows = hit?.flows || [];
    } else {
      const sinceTs = opts.sinceTs || Date.now() / 1000 - 120;
      const delta = await networkDeltaSince({ ts: sinceTs }, { cfg: opts.cfg || null });
      flows = delta.flows;
    }
  }
  const results = [];
  let allOk = true;
  for (const rule of rules) {
    const expect = {
      host: rule.match?.hostContains || rule.match?.host,
      method: rule.match?.method,
      pathContains: rule.match?.pathContains || rule.match?.pathPrefix,
      status: rule.expect?.status,
      minFlows: rule.expect?.minFlows ?? 1,
    };
    const verdict = assertOutcome(expect, flows || []);
    results.push({ id: rule.id, ok: verdict.ok, failures: verdict.failures, matched: verdict.matchedCount });
    if (!verdict.ok) allOk = false;
  }
  return { ok: allOk, checked: results.length, results };
}

/**
 * After a browser_* tool: if result has actionId and policy require rules, evaluate.
 * Controlled by XCLAW_TRUTH_AUTO_ASSERT=1 or opts.force.
 */
export async function afterBrowserToolTruth(toolName, result, opts = {}) {
  const auto =
    opts.force ||
    process.env.XCLAW_TRUTH_AUTO_ASSERT === "1" ||
    process.env.XCLAW_TRUTH_AUTO_ASSERT === "true";
  if (!auto) return null;
  if (!toolName || !String(toolName).startsWith("browser_")) return null;
  if (!isMitmEnabled(opts.cfg || null)) return null;

  const actionId = result?.metadata?.actionId;
  const policy = await loadPolicy(opts.cfg || null);
  const requires = requireRules(policy);
  if (!requires.length && !opts.expect) return null;

  const evaluation = await evaluateRequireRules(policy, {
    cfg: opts.cfg || null,
    actionId,
    flows: result?.metadata?.network?.flows,
  });

  if (opts.expect) {
    const flows = result?.metadata?.network?.flows || [];
    const extra = assertOutcome(opts.expect, flows);
    evaluation.inline = extra;
    if (!extra.ok) evaluation.ok = false;
  }

  return evaluation;
}

/**
 * Build a redacted proof / export bundle for audit.
 */
export async function exportProofBundle(opts = {}) {
  const cfg = opts.cfg || null;
  const confdir = mitmConfdir(cfg);
  const limit = opts.limit || 200;
  const sinceTs = opts.sinceTs;
  const flows = await readMitmFlows(cfg, { limit: limit * 2 });
  const filtered = sinceTs
    ? flows.filter((f) => Number(f.ts) >= Number(sinceTs))
    : flows.slice(0, limit);

  const bindings = await readActionBindings({ cfg, limit: 100 });
  const policy = await loadPolicy(cfg);
  const caPath = await findMitmCaCert();

  const bundle = {
    version: 1,
    kind: "xclaw-truth-proof",
    exportedAt: new Date().toISOString(),
    mitmEnabled: isMitmEnabled(cfg),
    confdir,
    caPresent: Boolean(caPath),
    policy: {
      version: policy.version,
      ruleCount: (policy.rules || []).length,
      rules: (policy.rules || []).map((r) => ({
        id: r.id,
        action: r.action,
        match: r.match,
        source: r.source,
      })),
    },
    flowCount: filtered.length,
    flows: filtered.map((f) => ({
      ts: f.ts,
      method: f.method,
      host: f.host,
      path: f.path,
      status: f.status,
      kind: f.kind,
      // bodies already redacted at write time when capture enabled
      url: typeof f.url === "string" ? f.url.slice(0, 300) : undefined,
    })),
    bindings: bindings.slice(0, 50),
  };

  const json = JSON.stringify(bundle, null, 2);
  const hash = crypto.createHash("sha256").update(json).digest("hex");
  bundle.contentSha256 = hash;

  const finalJson = JSON.stringify(bundle, null, 2);
  let outPath = opts.dest;
  if (!outPath) {
    const dir = path.join(confdir, "proofs");
    await fs.mkdir(dir, { recursive: true });
    outPath = path.join(dir, `proof_${Date.now()}.json`);
  } else {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
  }
  await fs.writeFile(outPath, finalJson + "\n");
  return { ok: true, path: outPath, sha256: hash, flowCount: bundle.flowCount, ruleCount: bundle.policy.ruleCount };
}

/**
 * Compile policy to env-ish view for addon (block list + maps).
 * Addon also reads policy.json directly when present.
 */
export function policyToEnvHints(policy) {
  const blocks = [];
  const maps = [];
  for (const r of policy?.rules || []) {
    if ((r.action === "block" || r.action === "deny") && r.match?.hostOrPathContains) {
      blocks.push(r.match.hostOrPathContains);
    } else if ((r.action === "block" || r.action === "deny") && r.match?.hostContains) {
      blocks.push(r.match.hostContains);
    }
    if (r.action === "map" && r.match?.pathPrefix != null && r.rewrite?.pathPrefix != null) {
      maps.push(`${r.match.pathPrefix}=>${r.rewrite.pathPrefix}`);
    }
  }
  return {
    XCLAW_MITM_BLOCK: blocks.join(","),
    XCLAW_MITM_MAP: maps.join(","),
  };
}

export default {
  POLICY_VERSION,
  emptyPolicy,
  loadPolicy,
  savePolicy,
  mergeEnvRules,
  matchRule,
  evaluateRequestPolicy,
  applyPathRewrite,
  requireRules,
  evaluateRequireRules,
  afterBrowserToolTruth,
  exportProofBundle,
  policyToEnvHints,
};
