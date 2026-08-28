/**
 * A latched condition that alerts on entry must also alert on EXIT.
 *
 * PagerDuty dedups on dedup_key: while an incident opened by `channel-outage:x`
 * is still open (from a blip days ago), the next genuine outage's trigger is
 * folded into it and does NOT re-notify. An incident that never closes is
 * therefore a fail-open on paging, not a stale row — which is why closing it
 * lives on the alerter as a primitive rather than being hand-rolled per call
 * site: doing it correctly means knowing that BOTH the severity floor and the
 * cooldown must be bypassed, and that the open marker must be CLEARED rather
 * than re-armed. Both call sites that tried it by hand got it wrong.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAlerter } from "../src/alerting/alerts.mjs";

// An unknown channel returns { ok:false, reason:"unsupported_channel:sink" }
// from deliverToChannel with NO network call — a deterministic offline target
// that still exercises the whole non-skipped path (results, markSent). A
// telegram target is not safe here: TELEGRAM_BOT_TOKEN may be set in the env.
const SINK = [{ channel: "sink", to: "x" }];

async function withAlerter(fn, alerting = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-alert-resolve-"));
  try {
    return await fn((extra = {}) =>
      createAlerter({
        paths: { configDir: dir },
        alerting: { enabled: true, targets: SINK, ...alerting, ...extra },
      })
    , dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("alerter.resolve() closes the incident its trigger opened", () => {
  it("bypasses the cooldown, then clears it so the NEXT outage still pages", async () => {
    await withAlerter(async (mk) => {
      const a = mk();
      const key = "res-test:cooldown";

      const t1 = await a.send({ key, severity: "error", title: "down" });
      assert.equal(t1.skipped, null, "trigger delivered");

      // the cooldown is real and still applies to triggers
      const dup = await a.send({ key, severity: "error", title: "down again" });
      assert.equal(dup.skipped, "cooldown", "repeat trigger suppressed");

      // …but a resolve must NOT be suppressed by it. Most outages are shorter
      // than cooldownMs (30min default), so a cooldown-gated resolve would mean
      // the incident is never closed at all.
      const r = await a.resolve({ key, severity: "error", title: "up" });
      assert.equal(r.skipped, null, "resolve bypasses the cooldown");
      assert.equal(r.sent, false, "…and still reports honest delivery status");

      // and it CLEARED the marker rather than re-arming it: markSent() on a
      // resolve would suppress the next genuine trigger for a full cooldown.
      const t2 = await a.send({ key, severity: "error", title: "down again" });
      assert.equal(t2.skipped, null, "resolve clears the open marker");
      assert.equal(a.status().lastSent[key] > 0, true, "…and the retrigger re-arms it");
    });
  });

  it("refuses to resolve a key that was never opened", async () => {
    await withAlerter(async (mk) => {
      const a = mk();
      const r = await a.resolve({ key: "res-test:never-opened", severity: "error", title: "up" });
      assert.equal(r.skipped, "not_open", "no RESOLVED page for a problem nobody heard about");
      assert.equal(r.results.length, 0);
    });
  });

  it("delivers below minSeverity — the floor gates pages, not their closure", async () => {
    await withAlerter(async (mk) => {
      const a = mk();
      const key = "res-test:min-severity";
      await a.send({ key, severity: "error", title: "down" });
      // The SLO monitor's exact bug: it sent recovery at severity "info", which
      // is below the default minSeverity "error", so the branch's only effect
      // was pushing a skipped entry onto its own return value.
      const r = await a.resolve({ key, severity: "info", title: "up" });
      assert.equal(r.skipped, null, "a resolve is never below the floor");
    });
  });

  it("a disabled alerter still resolves nothing (both gates hold)", async () => {
    await withAlerter(async (mk) => {
      const a = mk({ enabled: false });
      const r = await a.resolve({ key: "res-test:disabled", severity: "error", title: "up" });
      assert.equal(r.skipped, "disabled");
    });
  });

  it("sends event_action:resolve to PagerDuty under the trigger's dedup_key", async () => {
    const realFetch = globalThis.fetch;
    const bodies = [];
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes("pagerduty")) bodies.push(JSON.parse(opts.body));
      return { ok: true, status: 202, json: async () => ({ status: "success" }) };
    };
    try {
      await withAlerter(async (mk) => {
        // synthetic routing key — never a live credential in a test
        const a = mk({ targets: [], pagerduty: { routingKey: "R0UT1NG-KEY-FAKE" } });
        const key = "res-test:pagerduty";
        await a.send({ key, severity: "error", title: "down" });
        await a.resolve({ key, severity: "error", title: "up" });

        assert.equal(bodies.length, 2, "both events reached the Events API");
        assert.equal(bodies[0].event_action, "trigger");
        assert.equal(bodies[1].event_action, "resolve");
        assert.equal(
          bodies[1].dedup_key,
          bodies[0].dedup_key,
          "same dedup_key — a resolve under a different key opens a SECOND incident and leaves the first open forever"
        );
        assert.ok(bodies[1].dedup_key, "dedup_key is required on a resolve");
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("SLO monitor closes the incident it opened", () => {
  it("recovery resolves the BREACH's key, not a second incident of its own", async () => {
    const { checkAndAlertSLOs } = await import("../src/ops/slo-monitor.mjs");
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "xclaw-slo-resolve-"));
    const realFetch = globalThis.fetch;
    const bodies = [];
    globalThis.fetch = async (url, opts) => {
      // computeSLOs probes the computer server over fetch too — only the
      // PagerDuty enqueue is the subject here.
      if (String(url).includes("pagerduty")) bodies.push(JSON.parse(opts.body));
      return { ok: true, status: 202, json: async () => ({ status: "success" }) };
    };
    try {
      await fsp.mkdir(path.join(dir, "jobs"), { recursive: true });
      await fsp.writeFile(path.join(dir, "jobs", "index.jsonl"), '{"wallMs":900000}\n');
      const base = {
        paths: { configDir: dir },
        alerting: {
          enabled: true,
          targets: [],
          pagerduty: { routingKey: "R0UT1NG-KEY-FAKE" },
        },
        // computerUp:false and the zero/huge bounds keep job wall the ONLY
        // breach this test can produce, so the transition is deterministic.
        slo: { jobWallP99Ms: 1000, computerUp: false, approvalPendingMax: 1e9, approvalAgeP99Ms: 0 },
      };

      const breached = await checkAndAlertSLOs(base);
      assert.equal(breached.alerted.length, 1, "the breach pages");
      const key = `slo:${breached.breaches[0]}`;

      const recovered = await checkAndAlertSLOs({
        ...base,
        slo: { ...base.slo, jobWallP99Ms: 1e9 },
      });
      assert.equal(recovered.breaches.length, 0, "no longer breaching");
      assert.equal(recovered.resolved.length, 1, "recovery is reported");
      assert.equal(
        recovered.resolved[0].result.skipped,
        null,
        "…and actually DELIVERED — severity 'info' put this below minSeverity, so for its whole life this branch's only effect was pushing a skipped entry onto its own return value"
      );

      assert.equal(bodies.length, 2, "both events reached the Events API");
      assert.equal(bodies[0].event_action, "trigger");
      assert.equal(bodies[1].event_action, "resolve");
      assert.equal(
        bodies[1].dedup_key,
        bodies[0].dedup_key,
        `resolve must carry the breach's own key (${key}) — 'slo:resolve:<b>' would open a SECOND incident and leave the first open forever`
      );
    } finally {
      globalThis.fetch = realFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
