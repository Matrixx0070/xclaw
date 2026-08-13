/**
 * Gateway security HTTP routes (extracted from index.mjs).
 *
 * Paths:
 *   GET  /security/pending
 *   POST /security/decide
 *   GET  /security/policy
 *
 * Control plane owns approval UX; computer remains capability plane.
 */

import { computerEnginePolicySnapshot } from "../policy/computer-engine.mjs";

/**
 * @param {object} args
 * @param {string} args.p pathname
 * @param {string} args.method HTTP method
 * @param {import('node:http').IncomingMessage} args.req
 * @param {import('node:http').ServerResponse} args.res
 * @param {object} args.cfg
 * @param {object} args.approvalGate shared gate from security/approvals.mjs
 * @param {(res, status, body) => void} args.json
 * @param {(req) => Promise<object>} args.readBody
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleSecurityRoute({
  p,
  method,
  req,
  res,
  cfg,
  approvalGate,
  json,
  readBody,
}) {
  // Channel pairing (the control UI's Pairing panel called these since it
  // shipped — the routes never existed; 5th dead-route family found by the
  // endpoint sweep). The store is file-backed (~/.xclaw), so this instance
  // shares state with the channels' own pairing flows.
  if (p === "/pairing/pending" && method === "GET") {
    const url = new URL(req.url || p, "http://local");
    const channel = url.searchParams.get("channel") || "telegram";
    const { createPairingStore } = await import("../../pairing/pairing-store.mjs");
    const store = createPairingStore({});
    json(res, 200, {
      ok: true,
      channel,
      pending: store.listPending(channel),
      approved: store.listApproved(channel),
    });
    return true;
  }
  if (p === "/pairing/approve" && method === "POST") {
    const body = await readBody(req);
    if (!body.channel || !body.code) {
      json(res, 400, { error: "channel and code required" });
      return true;
    }
    const { createPairingStore } = await import("../../pairing/pairing-store.mjs");
    const out = createPairingStore({}).approve(body.channel, String(body.code));
    json(res, out.ok ? 200 : 404, out);
    return true;
  }
  if (p === "/pairing/revoke" && method === "POST") {
    const body = await readBody(req);
    if (!body.channel || !body.senderId) {
      json(res, 400, { error: "channel and senderId required" });
      return true;
    }
    const { createPairingStore } = await import("../../pairing/pairing-store.mjs");
    json(res, 200, createPairingStore({}).revoke(body.channel, String(body.senderId)));
    return true;
  }

  if (p === "/security/pending" && method === "GET") {
    const pending = approvalGate?.listPending?.() || [];
    const sla = approvalGate?.slaStats?.() || null;
    json(res, 200, {
      pending,
      count: pending.length,
      sla,
    });
    return true;
  }

  if (p === "/security/decide" && method === "POST") {
    let body = {};
    try {
      body = await readBody(req);
    } catch (err) {
      json(res, 400, { ok: false, error: "invalid_json", detail: err.message });
      return true;
    }
    const id = body.id || body.pendingId;
    if (!id) {
      json(res, 400, { ok: false, error: "id required" });
      return true;
    }
    const approved = Boolean(
      body.approved === true ||
        body.decision === "allow" ||
        body.decision === "allow-once" ||
        body.decision === "allow-always"
    );
    const note = body.note || body.reason || "";
    if (!approvalGate?.decide) {
      json(res, 503, { ok: false, error: "approval_gate_unavailable" });
      return true;
    }
    const out = approvalGate.decide(id, approved, note);
    json(res, out.ok ? 200 : 404, out);
    return true;
  }

  if (p === "/security/policy" && method === "GET") {
    let engine = null;
    try {
      engine = computerEnginePolicySnapshot(
        cfg,
        process.env.XCLAW_ROOT || process.cwd()
      );
    } catch {
      engine = null;
    }
    const gateInfo = approvalGate?.policyInfo?.() || null;
    json(res, 200, {
      telegram: cfg?.channels?.telegram || {},
      discord: cfg?.channels?.discord || {},
      security: cfg?.security || {},
      approvalGate: gateInfo,
      computerEngine: engine,
      controlPlane: "gateway",
    });
    return true;
  }

  return false;
}

export default { tryHandleSecurityRoute };
