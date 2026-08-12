/**
 * Inbound PagerDuty webhooks with HMAC-SHA256 signature verification.
 *
 * PagerDuty Webhooks V3:
 *   Header: X-PagerDuty-Signature: v1=<hex>[,v1=<hex>...]
 *   MAC:    HMAC_SHA256(secret, raw_request_body) as hex
 *   Rotate: multiple v1= signatures accepted (any match)
 *
 * https://developer.pagerduty.com/docs/ZG9jOjQ1MTg4Mzg-overview
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const handlers = new Map();
const recent = [];
const MAX_RECENT = 100;

function historyPath() {
  return path.join(os.homedir(), ".xclaw", "pd-webhook-events.jsonl");
}

export function onPagerDutyWebhook(eventType, fn) {
  if (!handlers.has(eventType)) handlers.set(eventType, []);
  handlers.get(eventType).push(fn);
  return () => {
    const arr = handlers.get(eventType) || [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  };
}

/**
 * Parse signature header into list of hex digests.
 * Accepts: "v1=abc,v1=def" | "v1=abc" | "abc"
 */
export function parseSignatureHeader(signatureHeader) {
  if (!signatureHeader) return [];
  const out = [];
  for (const part of String(signatureHeader).split(",")) {
    const p = part.trim();
    if (!p) continue;
    if (p.startsWith("v1=")) out.push(p.slice(3).trim().toLowerCase());
    else if (/^[a-fA-F0-9]{32,}$/.test(p)) out.push(p.toLowerCase());
  }
  return out;
}

/**
 * Compute PD-style body HMAC (hex).
 */
export function computePagerDutySignature(rawBody, secret) {
  const body =
    Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(String(rawBody ?? ""), "utf8");
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Timing-safe compare of two hex strings.
 * Pads/truncates via fixed-length SHA-256 digests so length mismatches
 * do not short-circuit before timingSafeEqual.
 */
export function safeEqualHex(a, b) {
  const ha = crypto.createHash("sha256").update(String(a ?? ""), "utf8").digest();
  const hb = crypto.createHash("sha256").update(String(b ?? ""), "utf8").digest();
  // Always 32-byte compare — no early return on length
  return crypto.timingSafeEqual(ha, hb) && String(a ?? "").length === String(b ?? "").length;
}

/**
 * Timing-safe equal for arbitrary byte buffers of equal max length.
 * If lengths differ, still runs timingSafeEqual on normalized digests.
 */
export function safeEqualBytes(a, b) {
  const ba = Buffer.isBuffer(a) ? a : Buffer.from(String(a ?? ""));
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(String(b ?? ""));
  const ha = crypto.createHash("sha256").update(ba).digest();
  const hb = crypto.createHash("sha256").update(bb).digest();
  const lenOk = ba.length === bb.length;
  return crypto.timingSafeEqual(ha, hb) && lenOk;
}

/**
 * Verify PagerDuty webhook HMAC.
 *
 * @param {string|Buffer} rawBody - exact bytes received (do not re-serialize JSON)
 * @param {string} signatureHeader - X-PagerDuty-Signature value
 * @param {string|string[]|null} secret - shared secret or list (rotation)
 * @param {object} [opts]
 * @param {boolean} [opts.required=false] - fail if secret set? default: secret null => open
 * @returns {{ ok: boolean, mode?: string, reason?: string, matchedVersion?: string }}
 */
export function verifyPagerDutySignature(
  rawBody,
  signatureHeader,
  secret,
  opts = {}
) {
  const secrets = normalizeSecrets(secret);
  const required =
    opts.required === true ||
    (opts.required !== false && secrets.length > 0);

  if (!secrets.length) {
    if (required) return { ok: false, reason: "secret_not_configured" };
    return { ok: true, mode: "open" };
  }

  // Always compute HMACs first (no early exit before crypto work)
  const expectedList = secrets.map((sec) =>
    computePagerDutySignature(rawBody, sec)
  );

  let provided = parseSignatureHeader(signatureHeader);
  // If missing, still run dummy compares against expected to reduce
  // timing difference between missing vs wrong signature.
  const missing = provided.length === 0;
  if (missing) {
    provided = expectedList.map(() => "0".repeat(64));
  }

  // Constant-ish work: compare every provided sig to every expected
  let match = false;
  for (const expected of expectedList) {
    for (const sig of provided) {
      if (safeEqualHex(sig, expected)) match = true;
    }
  }

  if (missing) {
    return { ok: false, reason: "missing_signature", mode: "hmac" };
  }
  if (match) {
    return { ok: true, mode: "hmac", matchedVersion: "v1" };
  }
  return { ok: false, reason: "bad_signature", mode: "hmac" };
}

function normalizeSecrets(secret) {
  if (secret == null || secret === "") return [];
  if (Array.isArray(secret)) {
    return secret.map(String).map((s) => s.trim()).filter(Boolean);
  }
  // allow comma-separated rotation list in one env var
  return String(secret)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Express/Node helper: read raw body from IncomingMessage.
 */
export async function readRawBody(req, { limit = 1_000_000 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error("body_too_large");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export function normalizePagerDutyWebhook(body) {
  if (body?.event) {
    const ev = body.event;
    const data = ev.data || {};
    return {
      version: "v3",
      eventType: ev.event_type || "unknown",
      resourceType: ev.resource_type,
      occurredAt: ev.occurred_at || data.created_at,
      incidentId: data.id || data.incident?.id,
      incidentNumber: data.number || data.incident_number,
      title: data.title || data.summary,
      status: data.status,
      urgency: data.urgency,
      serviceId: data.service?.id,
      serviceName: data.service?.summary || data.service?.name,
      assignees: data.assignees || data.assignments,
      htmlUrl: data.html_url,
      raw: body,
    };
  }

  if (Array.isArray(body?.messages) && body.messages.length) {
    const msg = body.messages[0];
    const incident = msg.incident || {};
    return {
      version: "classic",
      eventType: msg.event || "unknown",
      resourceType: "incident",
      occurredAt: msg.created_on,
      incidentId: incident.id,
      incidentNumber: incident.incident_number,
      title: incident.title || incident.summary || incident.description,
      status: incident.status,
      urgency: incident.urgency,
      serviceId: incident.service?.id,
      serviceName: incident.service?.name,
      htmlUrl: incident.html_url,
      raw: body,
    };
  }

  return {
    version: "unknown",
    eventType: body?.event_type || body?.type || "unknown",
    raw: body,
  };
}

function appendHistory(event) {
  recent.push(event);
  while (recent.length > MAX_RECENT) recent.shift();
  try {
    fs.mkdirSync(path.dirname(historyPath()), { recursive: true });
    fs.appendFileSync(
      historyPath(),
      JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n"
    );
  } catch (err) {
    console.error("[xclaw:pd-webhook] history", err.message);
  }
}

export async function handlePagerDutyWebhook(body, ctx = {}) {
  const event = normalizePagerDutyWebhook(body);
  appendHistory(event);

  const type = event.eventType || "unknown";
  console.log(
    `[xclaw:pd-webhook] ${type} incident=${event.incidentId || "—"} status=${event.status || "—"}`
  );

  const fns = [...(handlers.get(type) || []), ...(handlers.get("*") || [])];
  for (const fn of fns) {
    try {
      await fn(event, ctx);
    } catch (err) {
      console.error(`[xclaw:pd-webhook] handler error:`, err.message);
    }
  }

  if (ctx.onEvent) {
    ctx.onEvent({ type: "pagerduty", phase: "webhook", ...event });
  }

  if (ctx.alerter && shouldMirror(type, ctx.cfg)) {
    const sev = /escalate|delegated/i.test(type)
      ? "critical"
      : /resolve/i.test(type)
        ? "info"
        : "warn";
    await ctx.alerter
      .send({
        key: `pd-webhook:${event.incidentId || type}`,
        severity: sev,
        title: `PD ${type}: ${event.title || event.incidentId || ""}`,
        body: [
          `status=${event.status || "—"}`,
          event.serviceName ? `service=${event.serviceName}` : "",
          event.htmlUrl || "",
        ]
          .filter(Boolean)
          .join("\n"),
        meta: { incidentId: event.incidentId, eventType: type },
      })
      .catch(() => {});
  }

  return { ok: true, event };
}

function shouldMirror(eventType, cfg = {}) {
  const mirror = cfg.alerting?.pagerduty?.webhooks?.mirrorToChannels;
  if (mirror === false) return false;
  if (mirror === true) return true;
  return /escalate|delegated|priority/i.test(eventType || "");
}

export function listRecentPagerDutyWebhooks(limit = 20) {
  return recent.slice(-limit).reverse();
}

export function getPagerDutyWebhookHistoryPath() {
  return historyPath();
}
