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
 *
 * These tests used to run every "trigger" through a target that never delivers,
 * so every incident they opened was a phantom — the suite could not tell an
 * alert that reached someone from one that reached nobody, and the alerter
 * could not either. That is the whole subject of the second describe below.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAlerter, describeFailures } from "../src/alerting/alerts.mjs";

// An unknown channel returns { ok:false, reason:"unsupported_channel:sink" }
// from deliverToChannel with NO network call — a deterministic target that
// always FAILS. A telegram target is not safe here: TELEGRAM_BOT_TOKEN may be
// set in the env, which would make this quietly deliver on some machines.
const SINK = [{ channel: "sink", to: "x" }];

// The only target that can genuinely SUCCEED offline: PagerDuty over a stubbed
// fetch. Anything an incident-is-open assertion depends on must go through it.
const PD = { targets: [], pagerduty: { routingKey: "R0UT1NG-KEY-FAKE" } };

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

/** Runs `fn` with a fetch that accepts every PagerDuty enqueue, recording bodies. */
async function withPagerDuty(fn, alerting = {}) {
  const realFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("pagerduty")) bodies.push(JSON.parse(opts.body));
    return { ok: true, status: 202, json: async () => ({ status: "success" }) };
  };
  try {
    return await withAlerter((mk, dir) => fn(mk, bodies, dir), { ...PD, ...alerting });
  } finally {
    globalThis.fetch = realFetch;
  }
}

describe("alerter.resolve() closes the incident its trigger opened", () => {
  it("bypasses the cooldown, then clears it so the NEXT outage still pages", async () => {
    await withPagerDuty(async (mk) => {
      const a = mk();
      const key = "res-test:cooldown";

      const t1 = await a.send({ key, severity: "error", title: "down" });
      assert.equal(t1.skipped, null, "trigger attempted");
      assert.equal(t1.sent, true, "…and actually delivered — otherwise nothing is open");

      // the cooldown is real and still applies to triggers
      const dup = await a.send({ key, severity: "error", title: "down again" });
      assert.equal(dup.skipped, "cooldown", "repeat trigger suppressed");

      // …but a resolve must NOT be suppressed by it. Most outages are shorter
      // than cooldownMs (30min default), so a cooldown-gated resolve would mean
      // the incident is never closed at all.
      const r = await a.resolve({ key, severity: "error", title: "up" });
      assert.equal(r.skipped, null, "resolve bypasses the cooldown");
      assert.equal(r.sent, true, "…and reports honest delivery status");

      // and it CLEARED both markers rather than re-arming them: markSent() on a
      // resolve would suppress the next genuine trigger for a full cooldown.
      const t2 = await a.send({ key, severity: "error", title: "down again" });
      assert.equal(t2.skipped, null, "resolve clears the open marker");
      assert.equal(a.status().lastSent[key] > 0, true, "…and the retrigger re-arms it");
      assert.equal(a.status().lastDelivered[key] > 0, true, "…including the open marker");
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
    await withPagerDuty(async (mk) => {
      const a = mk();
      const key = "res-test:min-severity";
      const t = await a.send({ key, severity: "error", title: "down" });
      assert.equal(t.sent, true, "the incident must really be open for this to mean anything");
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
    await withPagerDuty(async (mk, bodies) => {
      const a = mk();
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
  });
});

describe("a delivery that FAILED opens nothing and buys no quiet period", () => {
  it("does not stamp the open marker", async () => {
    await withAlerter(async (mk) => {
      const a = mk(); // SINK: every target refuses
      const key = "res-fail:no-open";
      const t = await a.send({ key, severity: "error", title: "down" });
      assert.equal(t.sent, false, "nothing was delivered");
      assert.ok(a.status().lastSent[key] > 0, "the attempt is recorded — that paces retries");
      assert.equal(
        a.status().lastDelivered[key],
        undefined,
        "…but nobody was told, so no incident is open"
      );
    });
  });

  it("refuses to page RESOLVED for an incident nobody ever heard about", async () => {
    await withAlerter(async (mk) => {
      const a = mk();
      const key = "res-fail:phantom-resolve";
      await a.send({ key, severity: "error", title: "down" }); // fails
      const r = await a.resolve({ key, severity: "error", title: "up" });
      assert.equal(
        r.skipped,
        "not_open",
        "a failed trigger followed by a recovery used to page RESOLVED out of nowhere"
      );
    });
  });

  it("is retried well inside the 30-minute cooldown a delivered alert earns", async () => {
    await withAlerter(async (mk, dir) => {
      const a = mk();
      const key = "res-fail:retry";
      await a.send({ key, severity: "error", title: "down" }); // fails

      // Rewind the attempt by 90s on disk — longer than the 60s retry window,
      // far shorter than the 30min cooldown. A fresh alerter reads it back.
      const statePath = path.join(dir, "alert-state.json");
      const st = JSON.parse(await fsp.readFile(statePath, "utf8"));
      st.lastSent[key] = Date.now() - 90_000;
      await fsp.writeFile(statePath, JSON.stringify(st));

      const b = mk();
      assert.equal(b.status().retryCooldownMs, 60_000, "default retry window");
      const again = await b.send({ key, severity: "error", title: "down" });
      assert.equal(
        again.skipped,
        null,
        "an undelivered alert was suppressed for the full 30min — one Telegram blip lost the page"
      );
    });
  });

  it("keeps the full cooldown once an alert has actually landed", async () => {
    await withPagerDuty(async (mk, _bodies, dir) => {
      const a = mk();
      const key = "res-fail:delivered-cooldown";
      const t = await a.send({ key, severity: "error", title: "down" });
      assert.equal(t.sent, true);

      const statePath = path.join(dir, "alert-state.json");
      const st = JSON.parse(await fsp.readFile(statePath, "utf8"));
      st.lastSent[key] = Date.now() - 90_000;
      st.lastDelivered[key] = Date.now() - 90_000;
      await fsp.writeFile(statePath, JSON.stringify(st));

      const b = mk();
      const again = await b.send({ key, severity: "error", title: "down" });
      assert.equal(
        again.skipped,
        "cooldown",
        "the retry window must not become a spam window for alerts that DID land"
      );
    });
  });

  it("carries opens forward from a state file written before lastDelivered existed", async () => {
    await withAlerter(async (mk, dir) => {
      const key = "res-fail:migrated";
      // The old on-disk format: lastSent meant "open". Dropping those would
      // leave every incident open at upgrade time unclosable forever, and a PD
      // incident that never closes swallows the next genuine outage.
      await fsp.writeFile(
        path.join(dir, "alert-state.json"),
        JSON.stringify({ lastSent: { [key]: Date.now() - 90_000 }, history: [] })
      );
      const a = mk();
      assert.ok(a.status().lastDelivered[key] > 0, "the old stamp is honoured as an open");
      const r = await a.resolve({ key, severity: "error", title: "up" });
      assert.equal(r.skipped, null, "an incident open across the upgrade can still be closed");
    });
  });
});

describe("describeFailures names the target and the reason", () => {
  it("pairs each refusing target with why it refused", () => {
    assert.equal(
      describeFailures([
        { target: { channel: "telegram" }, ok: false, reason: "no_telegram_token" },
        { target: { type: "pagerduty" }, ok: false, reason: "http_502" },
      ]),
      "telegram(no_telegram_token),pagerduty(http_502)"
    );
  });

  it("ignores successes and dedups identical failures", () => {
    assert.equal(
      describeFailures([
        { target: { channel: "slack" }, ok: true },
        { target: { channel: "telegram" }, ok: false, reason: "no_telegram_token" },
        { target: { channel: "telegram" }, ok: false, reason: "no_telegram_token" },
      ]),
      "telegram(no_telegram_token)"
    );
  });

  it("never renders empty — an unexplained failure is the worst log line", () => {
    assert.equal(describeFailures([]), "no_result");
    assert.equal(describeFailures([{ target: { channel: "x" }, ok: false }]), "x");
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
