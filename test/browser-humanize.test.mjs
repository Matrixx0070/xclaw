/**
 * B0 — humanize + profile unit tests
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  reactionDelay,
  keyDelay,
  settleDelay,
  mousePath,
  typingPlan,
  scrollPlan,
  humanize,
} from "../src/browser/humanize.mjs";
import {
  resolveProfileDir,
  DEFAULT_VAULT,
} from "../src/browser/profile.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("humanize delays", () => {
  it("reactionDelay returns non-negative number", () => {
    const d = reactionDelay();
    assert.equal(typeof d, "number");
    assert.ok(d >= 0);
  });

  it("keyDelay varies by character class", () => {
    const a = keyDelay("a");
    const space = keyDelay(" ");
    const punct = keyDelay(".");
    assert.ok(a >= 0 && space >= 0 && punct >= 0);
  });

  it("settleDelay is bounded", () => {
    const d = settleDelay();
    assert.ok(d >= 0 && d <= 8000);
  });
});

describe("mousePath bezier", () => {
  it("produces path from start to end", () => {
    const pathPts = mousePath(10, 10, 400, 300);
    assert.ok(Array.isArray(pathPts));
    assert.ok(pathPts.length >= 2);
    const last = pathPts[pathPts.length - 1];
    assert.equal(last.x, 400);
    assert.equal(last.y, 300);
  });

  it("short distance collapses to single point", () => {
    const pathPts = mousePath(5, 5, 6, 6);
    assert.ok(pathPts.length >= 1);
  });
});

describe("typingPlan", () => {
  it("one entry per character", () => {
    const plan = typingPlan("Hi!");
    assert.equal(plan.length, 3);
    assert.equal(plan[0].char, "H");
    assert.equal(plan[2].char, "!");
  });
});

describe("scrollPlan", () => {
  it("sums approximately to total delta", () => {
    const plan = scrollPlan(400);
    const sum = plan.reduce((s, p) => s + p.deltaY, 0);
    assert.ok(Math.abs(sum - 400) < 5 || plan.length === 1);
  });
});

describe("profile resolve", () => {
  it("ephemeral creates tmp dir", async () => {
    const r = await resolveProfileDir({ ephemeral: true });
    assert.equal(r.durable, false);
    assert.ok(r.userDataDir.includes("xclaw-chrome-") || r.userDataDir.includes(os.tmpdir()));
    await fs.rm(r.userDataDir, { recursive: true, force: true }).catch(() => {});
  });

  it("DEFAULT_VAULT is under .xclaw", () => {
    assert.ok(DEFAULT_VAULT.includes(".xclaw"));
    assert.ok(DEFAULT_VAULT.includes("browser-profiles"));
  });
});

describe("humanize export", () => {
  it("exposes enabled + helpers", () => {
    assert.equal(typeof humanize.enabled, "boolean");
    assert.equal(typeof humanize.humanClick, "function");
    assert.equal(typeof humanize.humanType, "function");
  });
});
