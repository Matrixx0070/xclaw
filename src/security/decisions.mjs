/**
 * Durable approval decisions ("allow-always", brief gap 1.7) — slice A2.
 *
 * A pinned decision approves a PLAN, not a tool name: the default pin is the
 * frozen systemRunPlan fingerprint (exact argv+cwd+exe), so TOCTOU
 * revalidation still runs on every pinned approval. Looser `command` pins
 * (exe + argv0) are opt-in ("wide") and always expire.
 *
 * Store: ~/.xclaw/decisions.json — atomic tmp+rename, same convention as the
 * mission store.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getConfigDir } from "../config/load.mjs";
import { tierRank } from "./risk.mjs";

const WIDE_DEFAULT_TTL_MS = 30 * 86400_000;

export function decisionsPath(cfg = {}) {
  return (
    cfg.security?.decisionsPath ||
    path.join(cfg.paths?.configDir || getConfigDir(), "decisions.json")
  );
}

export async function loadDecisions(cfg = {}) {
  try {
    const d = JSON.parse(await fs.readFile(decisionsPath(cfg), "utf8"));
    return Array.isArray(d.decisions) ? d.decisions : [];
  } catch {
    return [];
  }
}

async function saveDecisions(cfg, decisions) {
  const p = decisionsPath(cfg);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ v: 1, decisions }, null, 2), "utf8");
  await fs.rename(tmp, p);
}

function pruneExpired(decisions) {
  const now = Date.now();
  return decisions.filter((d) => !d.expiresAt || Date.parse(d.expiresAt) > now);
}

/**
 * Persist a pin from an approved pending item.
 * opts: { wide?: boolean, ttlMs?: number, maxTier?: string, note?, createdBy? }
 */
export async function addDecision(cfg, { tool, plan, tier }, opts = {}) {
  if (!plan?.fingerprint && !opts.wide) {
    return { ok: false, error: "no plan fingerprint to pin (non-exec tool?)" };
  }
  const wide = opts.wide === true;
  // L1: a wide (loose exe+argv0) pin MUST expire — a 0/falsy ttl falls back to
  // the default rather than becoming permanent.
  const ttlMs = wide
    ? (opts.ttlMs && opts.ttlMs > 0 ? opts.ttlMs : WIDE_DEFAULT_TTL_MS)
    : (opts.ttlMs ?? null);
  const decision = {
    id: `dec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    tool: String(tool),
    pin: wide
      ? {
          kind: "command",
          exe: plan?.exe || null,
          argv0: plan?.argv?.[0] || null,
        }
      : { kind: "fingerprint", value: plan.fingerprint },
    maxTier: opts.maxTier || tier || "risky",
    note: opts.note || null,
    createdBy: opts.createdBy || "operator",
    createdAt: new Date().toISOString(),
    expiresAt: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : null,
  };
  const decisions = pruneExpired(await loadDecisions(cfg));
  decisions.push(decision);
  await saveDecisions(cfg, decisions);
  return { ok: true, decision };
}

export async function removeDecision(cfg, id) {
  const decisions = await loadDecisions(cfg);
  const next = decisions.filter((d) => d.id !== id);
  if (next.length === decisions.length) return { ok: false, error: "not found" };
  await saveDecisions(cfg, next);
  return { ok: true };
}

/**
 * Find a live pin covering this (tool, plan, assessed tier). A pin whose
 * maxTier is below the CURRENT assessed tier does not match — a decision made
 * when a command was "risky" cannot cover it after it drifts to "critical".
 */
export async function matchDecision(cfg, { tool, plan, tier }) {
  const decisions = pruneExpired(await loadDecisions(cfg));
  for (const d of decisions) {
    if (d.tool !== String(tool)) continue;
    if (tierRank(tier) > tierRank(d.maxTier)) continue;
    if (d.pin?.kind === "fingerprint") {
      if (plan?.fingerprint && d.pin.value === plan.fingerprint) return d;
    } else if (d.pin?.kind === "command") {
      if (
        plan?.exe &&
        d.pin.exe === plan.exe &&
        (!d.pin.argv0 || d.pin.argv0 === plan?.argv?.[0])
      ) {
        return d;
      }
    }
  }
  return null;
}

/**
 * S6b — the ONE PolicyDecision shape. Every security gate that blocks,
 * pends, or allows a tool call describes the ruling with this constructor;
 * the tool trace, security events, and run results all carry the same
 * structure instead of five ad-hoc `policy:` literals (audit C15: "the
 * agent gets prose, not a typed denial").
 *
 * @param {object} d
 * @param {"approval"|"plan_revalidate"|"sandbox"|"egress"|"receipt"|"quota"|"guard"|string} d.phase — which gate ruled
 * @param {"allow"|"deny"|"pending"} d.decision
 * @param {string} [d.reason] — machine-usable slug/short reason
 * @param {string} [d.tool]
 * @param {string} [d.tier] — risk tier when the gate computed one
 * @param {string} [d.pendingId]
 * @param {string} [d.message] — human/model-facing explanation
 */
export function policyDecision(d = {}) {
  return {
    v: 1,
    phase: d.phase || "policy",
    decision: d.decision || "deny",
    reason: d.reason ?? null,
    tool: d.tool ?? null,
    tier: d.tier ?? null,
    pendingId: d.pendingId ?? null,
    message: d.message ?? null,
  };
}
