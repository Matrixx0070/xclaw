import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { tryHandleAlertsRoute } from "../src/gateway/routes/alerts.mjs";
import {
  computePagerDutySignature,
  listRecentPagerDutyWebhooks,
} from "../src/alerting/pagerduty-webhooks.mjs";

/**
 * Sweep #39 — ROUTE wiring pin for the inbound PagerDuty webhook.
 *
 * `verifyPagerDutySignature` (the unit verifier) is exhaustively covered by
 * test/pagerduty-webhook-signature.test.mjs, but nothing drove the ROUTE
 * `tryHandleAlertsRoute` for `POST /webhooks/pagerduty` — the call site at
 * src/gateway/routes/alerts.mjs:73 that consumes `ver.ok`:
 *
 *     if (!ver.ok) { json(res, 401, {error:"invalid_signature"}); return true; }
 *     ... handlePagerDutyWebhook(body, {...})   // history append + alert mirror + ops broadcast
 *
 * That path is deliberately OPEN at the gateway token gate (auth.mjs:94) — the
 * HMAC verifier IS the authenticator. Mutating line 73 to `if (false)` (forged
 * webhooks always processed) left the FULL suite GREEN: the reject-before-
 * side-effect wiring was unpinned. This drives the route directly and asserts
 * that an unverified webhook is rejected 401 AND never reaches the privileged
 * side-effect, while a verified webhook is accepted and does. #37-shape
 * call-site wiring pin: the verifier decision is sound, this pins the route's
 * consumption of it.
 */

// Redirect the on-disk history append (~/.xclaw/pd-webhook-events.jsonl) into a
// throwaway dir so the accept case stays hermetic. `node --test` isolates each
// test FILE in its own process, so this HOME override cannot leak to siblings.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-pd-route-"));
const PRIOR_HOME = process.env.HOME;
process.env.HOME = TMP_HOME;

const SECRET = "pd-webhook-secret-xyz";
const BODY = JSON.stringify({
  event: {
    event_type: "incident.triggered",
    resource_type: "incident",
    data: { id: "PABC123", status: "triggered", title: "disk full" },
  },
});

function makeReq(sig) {
  const headers = {};
  if (sig !== undefined) headers["x-pagerduty-signature"] = sig;
  const req = Readable.from([Buffer.from(BODY, "utf8")]);
  req.headers = headers;
  return req;
}

async function driveRoute(sig) {
  const calls = [];
  const handled = await tryHandleAlertsRoute({
    p: "/webhooks/pagerduty",
    method: "POST",
    req: makeReq(sig),
    res: {},
    url: new URL("http://local/webhooks/pagerduty"),
    cfg: { alerting: { pagerduty: { webhooks: { secret: SECRET } } } },
    json: (_res, status, payload) => calls.push({ status, payload }),
    readBody: async () => ({}),
  });
  return { handled, calls };
}

describe("pagerduty webhook ROUTE wiring (verify → 401 before side-effect)", () => {
  after(() => {
    if (PRIOR_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = PRIOR_HOME;
    try {
      fs.rmSync(TMP_HOME, { recursive: true, force: true });
    } catch {}
  });

  it("forged signature → 401 invalid_signature AND handler side-effect does NOT run", async () => {
    const before = listRecentPagerDutyWebhooks(100).length;
    const { handled, calls } = await driveRoute("v1=" + "a".repeat(64));
    assert.equal(handled, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].status, 401);
    assert.equal(calls[0].payload.error, "invalid_signature");
    // The privileged side-effect (history append + alert mirror + ops
    // broadcast) must NOT run for an unverified webhook.
    assert.equal(
      listRecentPagerDutyWebhooks(100).length,
      before,
      "forged webhook must not append history"
    );
  });

  it("missing signature (secret configured) → 401 missing_signature AND no side-effect", async () => {
    const before = listRecentPagerDutyWebhooks(100).length;
    const { handled, calls } = await driveRoute(undefined);
    assert.equal(handled, true);
    assert.equal(calls[0].status, 401);
    assert.equal(calls[0].payload.reason, "missing_signature");
    assert.equal(listRecentPagerDutyWebhooks(100).length, before);
  });

  it("valid signature → 200 ok AND handler side-effect runs (guards always-reject)", async () => {
    const before = listRecentPagerDutyWebhooks(100).length;
    const good = "v1=" + computePagerDutySignature(BODY, SECRET);
    const { handled, calls } = await driveRoute(good);
    assert.equal(handled, true);
    assert.equal(calls[0].status, 200);
    assert.equal(calls[0].payload.ok, true);
    assert.equal(
      listRecentPagerDutyWebhooks(100).length,
      before + 1,
      "verified webhook must append history"
    );
  });
});
