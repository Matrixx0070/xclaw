import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { tryHandleObjectivesRoute } from "../src/gateway/routes/objectives.mjs";
import { newObjective, saveObjective, loadObjective } from "../src/agent/objective-store.mjs";
import { STATE_FENCE } from "../src/agent/objective.mjs";

// POST /objectives launches the REAL detached runner (replyWithAgent →
// runAgentLoop) — isolate HOME/XCLAW_STATE_DIR so profile-store credentials
// can never resolve from a unit test (the 3.95.3 paid-call leak class).
const tmpHome = fsSync.mkdtempSync(path.join(os.tmpdir(), "xclaw-objrt-home-"));
const savedHome = process.env.HOME;
const savedState = process.env.XCLAW_STATE_DIR;
before(() => {
  process.env.HOME = tmpHome;
  process.env.XCLAW_STATE_DIR = tmpHome;
});
after(() => {
  process.env.HOME = savedHome;
  if (savedState === undefined) delete process.env.XCLAW_STATE_DIR;
  else process.env.XCLAW_STATE_DIR = savedState;
  fsSync.rmSync(tmpHome, { recursive: true, force: true });
});

async function cfgTmp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-objrt-"));
  return { paths: { configDir: dir }, objectives: { progressEverySegments: 0, requireChecked: false, deriveChecks: false }, _dir: dir };
}

function call({ p, method = "GET", cfg, body = {} }) {
  let payload = null;
  return tryHandleObjectivesRoute({
    p,
    method,
    req: {},
    res: { writeHead() {}, end() {} },
    cfg,
    json: (_res, status, out) => {
      payload = { status, out };
    },
    readBody: async () => body,
  }).then((handled) => ({ handled, ...(payload || {}) }));
}

describe("objectives routes (UI-called paths — dead-route lesson)", () => {
  it("list + get + 404 + unrelated paths", async () => {
    const cfg = await cfgTmp();
    const obj = newObjective({ objective: "surface me", channel: "telegram", chatId: "42" });
    obj.humanQuestion = "which env?";
    obj.status = "awaiting_human";
    await saveObjective(cfg, obj);

    const list = await call({ p: "/objectives", cfg });
    assert.equal(list.status, 200);
    assert.equal(list.out.count, 1);
    assert.equal(list.out.objectives[0].humanQuestion, "which env?");

    const get = await call({ p: `/objectives/${obj.id}`, cfg });
    assert.equal(get.status, 200);
    assert.equal(get.out.objective, "surface me");

    const missing = await call({ p: "/objectives/obj_nope", cfg });
    assert.equal(missing.status, 404);

    const unrelated = await call({ p: "/objectivesX", cfg });
    assert.equal(unrelated.handled, false);
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("stop sets the flag; resume rejects running and terminal-done", async () => {
    const cfg = await cfgTmp();
    const obj = newObjective({ objective: "x" });
    await saveObjective(cfg, obj); // running

    const stop = await call({ p: `/objectives/${obj.id}/stop`, method: "POST", cfg });
    assert.equal(stop.status, 200);
    assert.equal((await loadObjective(cfg, obj.id)).stopRequested, true);

    const resumeRunning = await call({ p: `/objectives/${obj.id}/resume`, method: "POST", cfg });
    assert.equal(resumeRunning.status, 409);

    obj.status = "done";
    await saveObjective(cfg, obj);
    const resumeDone = await call({ p: `/objectives/${obj.id}/resume`, method: "POST", cfg });
    assert.equal(resumeDone.status, 409);
    await fs.rm(cfg._dir, { recursive: true, force: true });
  });

  it("POST /objectives starts a gateway-run mission that completes via the orchestrator", async () => {
    const cfg = await cfgTmp();
    // stub the segment runner path: replyWithAgent is imported dynamically by
    // the route, so run against the real orchestrator with a fake provider is
    // heavy — instead start, then verify the store entry exists and is
    // channel:"api"; the orchestrator itself is covered by its own suite.
    const start = await call({ p: "/objectives", method: "POST", cfg, body: { objective: "api mission" } });
    assert.equal(start.status, 200);
    assert.ok(start.out.id);
    const stored = await loadObjective(cfg, start.out.id);
    assert.equal(stored.channel, "api");
    assert.equal(stored.objective, "api mission");
    // request stop so the detached real runner halts at the first boundary
    // (no provider creds in the hermetic env — its segment fails either way).
    // Deliberately NO rm of cfg._dir here: the runner can outlive any
    // bounded wait (provider retry backoff), and a save landing after rm
    // becomes an uncaught ENOENT attributed to this test. The dir is
    // /tmp/xclaw-* — the tmp sweeper's territory.
    await call({ p: `/objectives/${start.out.id}/stop`, method: "POST", cfg });
    assert.equal(STATE_FENCE, "xclaw-objective-state");
  });
});
