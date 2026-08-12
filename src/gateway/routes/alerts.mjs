/**
 * Gateway alerting + doctor HTTP routes (extracted from index.mjs).
 *
 * Paths:
 *   POST /webhooks/pagerduty · GET /webhooks/pagerduty/recent
 *   GET  /alerts/status · /alerts/history · /alerts/pd/levels · /alerts/pd/setup
 *        /alerts/pd/policies · /alerts/pd/services
 *   POST /alerts/pd/levels · /alerts/pd · /alerts/test
 *   POST /doctor/run · GET|* /doctor · /gateway/doctor
 */
import { getSharedAlerter } from "../../alerting/alerts.mjs";
import {
  handlePagerDutyWebhook,
  verifyPagerDutySignature,
  listRecentPagerDutyWebhooks,
  readRawBody,
} from "../../alerting/pagerduty-webhooks.mjs";
import { broadcast as wsBroadcast } from "../ws-hub.mjs";
import { buildDoctorReport } from "../doctor.mjs";
import { isComputerRunning } from "../../computer/manager.mjs";

/**
 * @param {object} args — standard route args + channelManager (live instance)
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleAlertsRoute({
  p,
  method,
  req,
  res,
  url,
  cfg,
  json,
  readBody,
  channelManager,
}) {
  // PagerDuty inbound webhooks — HMAC on raw body
  if (p === "/webhooks/pagerduty" && method === "POST") {
    let rawBuf;
    try {
      rawBuf = await readRawBody(req, { limit: 1_000_000 });
    } catch (err) {
      json(res, 413, { error: err.message || "body_too_large" });
      return true;
    }
    const raw = rawBuf.toString("utf8");
    const secret =
      cfg.alerting?.pagerduty?.webhooks?.secret ||
      cfg.alerting?.pagerduty?.webhooks?.secrets ||
      process.env.PAGERDUTY_WEBHOOK_SECRET;
    const requireSig =
      cfg.alerting?.pagerduty?.webhooks?.requireSignature === true ||
      Boolean(secret);
    const sig =
      req.headers["x-pagerduty-signature"] ||
      req.headers["x-pd-signature"] ||
      "";
    const ver = verifyPagerDutySignature(rawBuf, sig, secret, {
      required: requireSig,
    });
    if (!ver.ok) {
      console.warn(`[xclaw:pd-webhook] reject: ${ver.reason}`);
      json(res, 401, {
        error: "invalid_signature",
        reason: ver.reason,
      });
      return true;
    }
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      json(res, 400, { error: "invalid_json" });
      return true;
    }
    const out = await handlePagerDutyWebhook(body, {
      cfg,
      alerter: getSharedAlerter(cfg),
      onEvent: (e) => {
        try {
          wsBroadcast("ops", e);
        } catch {}
      },
    });
    json(res, 200, {
      ok: true,
      eventType: out.event?.eventType,
      verified: ver.mode,
    });
    return true;
  }
  if (p === "/webhooks/pagerduty/recent" && method === "GET") {
    json(res, 200, {
      events: listRecentPagerDutyWebhooks(
        Number(url.searchParams.get("limit") || 20)
      ),
    });
    return true;
  }

  if (p === "/alerts/status" && method === "GET") {
    json(res, 200, getSharedAlerter(cfg).status());
    return true;
  }
  if (p === "/alerts/history" && method === "GET") {
    const limit = Number(url.searchParams.get("limit") || 20);
    json(res, 200, { history: getSharedAlerter(cfg).history(limit) });
    return true;
  }
  if (p === "/alerts/pd/levels" && method === "GET") {
    const { previewEscalationLevels, diffEscalationLevels } = await import(
      "../../alerting/escalation-levels.mjs"
    );
    const mode = url.searchParams.get("mode") || "preview";
    if (mode === "diff") {
      json(res, 200, await diffEscalationLevels(cfg));
      return true;
    }
    json(res, 200, previewEscalationLevels(cfg));
    return true;
  }
  if (p === "/alerts/pd/levels" && method === "POST") {
    const { applyEscalationLevels } = await import("../../alerting/escalation-levels.mjs");
    const body = await readBody(req).catch(() => ({}));
    const out = await applyEscalationLevels(cfg, body);
    json(res, out.ok ? 200 : 502, out);
    return true;
  }
  if (p === "/alerts/pd/setup" && method === "GET") {
    const { pagerDutySetupReport } = await import("../../alerting/pagerduty-rest.mjs");
    json(res, 200, await pagerDutySetupReport(cfg));
    return true;
  }
  if (p === "/alerts/pd/policies" && method === "GET") {
    const { listEscalationPolicies } = await import("../../alerting/pagerduty-rest.mjs");
    const out = await listEscalationPolicies({ query: url.searchParams.get("query") }, cfg);
    json(res, out.ok ? 200 : 502, out);
    return true;
  }
  if (p === "/alerts/pd/services" && method === "GET") {
    const { listServices } = await import("../../alerting/pagerduty-rest.mjs");
    const out = await listServices({}, cfg);
    json(res, out.ok ? 200 : 502, out);
    return true;
  }
  if (p === "/alerts/pd" && method === "POST") {
    const { sendPagerDutyEvent, pagerDutyDedupKey } = await import("../../alerting/pagerduty.mjs");
    const body = await readBody(req);
    const out = await sendPagerDutyEvent({
      routingKey:
        body.routingKey ||
        cfg.alerting?.pagerduty?.routingKey ||
        process.env.PAGERDUTY_ROUTING_KEY,
      eventAction: body.eventAction || body.action || "trigger",
      dedupKey: pagerDutyDedupKey(body.dedupKey || body.key || `xclaw:${Date.now()}`),
      summary: body.summary || body.title || "XClaw alert",
      severity: body.severity || "error",
      customDetails: body.customDetails || body.meta || {},
    });
    json(res, out.ok ? 200 : 502, out);
    return true;
  }
  if (p === "/alerts/test" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const out = await getSharedAlerter(cfg).send({
      title: body.title || "Test alert",
      body: body.body || "Manual test from XClaw",
      severity: body.severity || "error",
      key: body.key || `test:${Date.now()}`,
    });
    json(res, 200, out);
    return true;
  }
  if (p === "/doctor/run" && method === "POST") {
    const { runDoctorCheck } = await import("../../cron/doctor-job.mjs");
    const body = await readBody(req).catch(() => ({}));
    const out = await runDoctorCheck({
      cfg,
      channelManager,
      isComputerRunning,
      notifyOnFail: body.notifyOnFail !== false,
      notifyOnOk: body.notifyOnOk === true,
      delivery: body.delivery || cfg.doctor?.cron?.delivery || null,
    });
    json(res, out.report.ok ? 200 : 503, out);
    return true;
  }
  if (p === "/doctor" || p === "/gateway/doctor") {
    const report = await buildDoctorReport({
      cfg,
      channelManager,
      isComputerRunning,
    });
    json(res, report.ok ? 200 : 503, report);
    return true;
  }

  return false;
}

export default { tryHandleAlertsRoute };
