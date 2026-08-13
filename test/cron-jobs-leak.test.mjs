import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

// /cron/jobs used to return each job's `_cfg` — the FULL resolved config,
// including gateway.token, telegram bot token and the agent's live OAuth
// access token (found 2026-08-13 while building the Automations UI). The
// route must strip _cfg/cfg/handler from every response shape.
import { tryHandleCronRoute } from "../src/gateway/routes/cron.mjs";
import { addJob, cancelJob } from "../src/cron/scheduler.mjs";

const SECRET_CFG = {
  gateway: { token: "SUPER-SECRET-TOKEN" },
  agent: { apiKey: "sk-ant-oat01-SECRET" },
  channels: { telegram: { token: "BOT-SECRET" } },
};

const job = addJob({
  name: "leak-probe",
  intervalMs: 3_600_000,
  cfg: SECRET_CFG,
  handler: async () => {},
});

after(() => cancelJob(job.id));

function call(p, method) {
  let out = null, status = null;
  return tryHandleCronRoute({
    p, method,
    req: { headers: {}, url: p },
    res: {},
    url: new URL("http://x" + p),
    cfg: SECRET_CFG,
    json: (_r, c, payload) => { status = c; out = payload; },
    readBody: async () => ({}),
  }).then((handled) => ({ handled, status, out }));
}

describe("cron routes never leak config", () => {
  it("GET /cron/jobs strips _cfg/handler from every job", async () => {
    const { handled, status, out } = await call("/cron/jobs", "GET");
    assert.equal(handled, true);
    assert.equal(status, 200);
    const mine = out.jobs.find((j) => j.id === job.id);
    assert.ok(mine, "created job listed");
    const raw = JSON.stringify(out);
    assert.ok(!raw.includes("SUPER-SECRET-TOKEN"), "gateway token must not appear");
    assert.ok(!raw.includes("sk-ant-oat01-SECRET"), "agent credential must not appear");
    assert.ok(!raw.includes("BOT-SECRET"), "bot token must not appear");
    assert.equal(mine._cfg, undefined);
    assert.equal(mine.handler, undefined);
  });

  it("GET /cron/jobs/:id strips too", async () => {
    const { status, out } = await call("/cron/jobs/" + job.id, "GET");
    assert.equal(status, 200);
    const raw = JSON.stringify(out);
    assert.ok(!raw.includes("SUPER-SECRET-TOKEN"));
    assert.equal(out._cfg, undefined);
  });
});
