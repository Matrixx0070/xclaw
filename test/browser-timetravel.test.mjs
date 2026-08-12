import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {
  loadTimeline,
  buildReplayPlan,
  scoreCausal,
  buildSyntheticOriginCatalog,
  startSyntheticOrigin,
  timeTravelReport,
} from "../src/browser/timetravel.mjs";
import { createBrowserTools } from "../src/tools/browser-tools.mjs";
import { scoreCase } from "../src/eval/scorer.mjs";

describe("Horizon 5 Time-travel & causal eval", () => {
  let tmp;
  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-tt-"));
    process.env.XCLAW_MITM_CONFDIR = tmp;
    await fs.writeFile(
      path.join(tmp, "flows.jsonl"),
      [
        JSON.stringify({
          ts: 100,
          method: "GET",
          host: "api.shop.test",
          path: "/v1/cart",
          status: 200,
          url: "https://api.shop.test/v1/cart",
          res_body: '{"ok":true}',
          content_type: "application/json",
        }),
        JSON.stringify({
          ts: 110,
          method: "POST",
          host: "api.shop.test",
          path: "/v1/checkout",
          status: 201,
          url: "https://api.shop.test/v1/checkout",
          res_body: '{"order":1}',
          content_type: "application/json",
        }),
      ].join("\n") + "\n"
    );
    await fs.writeFile(
      path.join(tmp, "action-bindings.jsonl"),
      JSON.stringify({
        actionId: "act_test1",
        ts: 105,
        label: "browser_snapshot",
        flowCount: 1,
        flows: [{ method: "GET", host: "api.shop.test", path: "/v1/cart", status: 200 }],
      }) + "\n"
    );
  });
  after(async () => {
    delete process.env.XCLAW_MITM_CONFDIR;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("loadTimeline merges flows and bindings", async () => {
    const t = await loadTimeline({ limit: 50 });
    assert.ok(t.flowCount >= 2);
    assert.ok(t.bindingCount >= 1);
    assert.ok(t.events.length >= 3);
  });

  it("buildReplayPlan has action steps", async () => {
    const t = await loadTimeline({ limit: 50 });
    const plan = buildReplayPlan(t, { includeUnboundFlows: true });
    assert.ok(plan.stepCount >= 1);
    assert.ok(plan.steps.some((s) => s.type === "action"));
  });

  it("scoreCausal passes matching network expect", async () => {
    const t = await loadTimeline({ limit: 50 });
    const ok = scoreCausal(
      {
        network: [
          { host: "api.shop.test", method: "POST", pathContains: "/checkout", status: 201 },
        ],
        actions: ["browser_snapshot"],
        minFlows: 2,
        forbidHosts: ["evil.tracker"],
      },
      t
    );
    assert.equal(ok.pass, true, JSON.stringify(ok.failures));
  });

  it("scoreCausal fails forbidHosts", async () => {
    const t = await loadTimeline({ limit: 50 });
    const bad = scoreCausal({ forbidHosts: ["api.shop.test"] }, t);
    assert.equal(bad.pass, false);
  });

  it("synthetic origin serves recorded response", async () => {
    const t = await loadTimeline({ limit: 50 });
    const cat = buildSyntheticOriginCatalog(t.flows);
    assert.ok(cat.length >= 1);
    const syn = await startSyntheticOrigin(cat);
    try {
      const body = await new Promise((resolve, reject) => {
        http
          .get(syn.url + "/v1/cart", { headers: { Host: "api.shop.test" } }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () =>
              resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8"), h: res.headers })
            );
          })
          .on("error", reject);
      });
      assert.equal(body.status, 200);
      assert.ok(body.text.includes("ok"));
      assert.equal(body.h["x-xclaw-synthetic"], "1");
    } finally {
      await syn.close();
    }
  });

  it("timeTravelReport returns plan + causal", async () => {
    const r = await timeTravelReport({
      expect: { minFlows: 1 },
      limit: 50,
    });
    assert.equal(r.kind, "xclaw-timetravel-report");
    assert.ok(r.plan.stepCount >= 1);
    assert.equal(r.causal.pass, true);
  });

  it("eval scoreCase attaches causal", async () => {
    const scored = await scoreCase(
      {
        id: "t",
        expect: {
          causal: {
            network: [{ host: "api.shop.test", method: "GET", status: 200 }],
            minFlows: 1,
          },
        },
      },
      { workspace: tmp, turns: 1, toolCalls: 0, text: "ok", events: [] }
    );
    assert.ok(scored.causal);
    assert.equal(scored.pass, true, JSON.stringify(scored.failures));
  });

  it("tools registered", () => {
    const names = createBrowserTools({}).map((t) => t.name);
    assert.ok(names.includes("trace_replay"));
    assert.ok(names.includes("trace_score"));
  });
});
