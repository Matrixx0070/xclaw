/**
 * RULE(n) sweep #63 — the readiness queue load-shed bound. Fail-opening
 * `if (queued > maxQueued) ready = false` left the FULL suite green
 * (3858/0): /ready would report ready forever on a drowning queue and a
 * load balancer would keep routing to it. Pins BOTH boundary lines
 * behaviorally against the real checkReadiness with a real (empty, tmp)
 * queue dir: maxQueued -1 puts even an empty queue over the bound (deny
 * fires → not_ready/503), maxQueued 0 sits exactly on it (<= admits →
 * ready/200).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkReadiness } from "../src/gateway/readiness.mjs";

function tmpCfg(maxQueued) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-readyq-"));
  return {
    dir,
    cfg: {
      profile: "lab",
      paths: { configDir: dir },
      readiness: { requireComputer: false, maxQueued },
    },
  };
}

describe("readiness queue bound (sweep #63)", () => {
  it("queue over the bound flips ready=false and 503 (load shed fires)", async () => {
    const { dir, cfg } = tmpCfg(-1);
    try {
      const r = await checkReadiness(cfg);
      assert.equal(r.body.checks.queue.ok, false);
      assert.equal(r.body.checks.queue.maxQueued, -1);
      assert.equal(r.ready, false);
      assert.equal(r.status, 503);
      assert.equal(r.body.status, "not_ready");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("queue exactly at the bound stays ready (<= admits the boundary)", async () => {
    const { dir, cfg } = tmpCfg(0);
    try {
      const r = await checkReadiness(cfg);
      assert.equal(r.body.checks.queue.queued ?? 0, 0);
      assert.equal(r.body.checks.queue.ok, true);
      assert.equal(r.ready, true);
      assert.equal(r.status, 200);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
